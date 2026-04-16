import fs from "node:fs/promises";
import { ExtractTsContracts } from "../../application/use-cases/extract-ts-contracts.js";
import { LowerContractBundleToRivetContract } from "../../application/use-cases/lower-contract-bundle-to-rivet-contract.js";
import { BuildLocalPackage } from "../../application/use-cases/build-local-package.js";
import { BuildLocalConfig, type BuildLocalTarget } from "../../domain/build-local-config.js";
import { TypeScriptContractFrontend } from "../../infrastructure/typescript/typescript-contract-frontend.js";
import { TypeScriptRivetContractLowerer } from "../../infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { TypeScriptHandlerEntrypointFrontend } from "../../infrastructure/typescript/typescript-handler-entrypoint-frontend.js";
import { LocalClientCodegen } from "../../infrastructure/codegen/local-client-codegen.js";
import { EsbuildImplementationBundler } from "../../infrastructure/bundler/esbuild-implementation-bundler.js";
import { LocalPackageEmitter } from "../../infrastructure/package/local-package-emitter.js";

type CliIO = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const DEFAULT_IO: CliIO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export const runCli = async (args: readonly string[], io: CliIO = DEFAULT_IO): Promise<number> => {
  if (args[0] === "build-local") {
    return runBuildLocal(args.slice(1), io);
  }

  return runReflect(args, io);
};

const runReflect = async (args: readonly string[], io: CliIO): Promise<number> => {
  const parsed = parseReflectArgs(args);

  if (!parsed.entryPath) {
    io.stderr("Usage: rivet-reflect-ts --entry <path> [--out <file>]\n");
    return 1;
  }

  const frontend = new TypeScriptContractFrontend();
  const lowerer = new TypeScriptRivetContractLowerer();
  const useCase = new ExtractTsContracts(frontend);
  const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);
  const bundle = await useCase.execute({ entryPath: parsed.entryPath });
  const lowered = await lowerUseCase.execute({ bundle });

  for (const diagnostic of lowered.diagnostics) {
    const location = diagnostic.filePath
      ? `${diagnostic.filePath}${diagnostic.line ? `:${diagnostic.line}:${diagnostic.column}` : ""}`
      : "(unknown)";
    io.stderr(`${diagnostic.severity}: [${diagnostic.code}] ${location} ${diagnostic.message}\n`);
  }

  const json = `${lowered.toJson()}\n`;

  if (parsed.outputPath) {
    await fs.writeFile(parsed.outputPath, json, "utf8");
  } else {
    io.stdout(json);
  }

  return lowered.hasErrors ? 1 : 0;
};

const runBuildLocal = async (args: readonly string[], io: CliIO): Promise<number> => {
  const parsed = parseBuildLocalArgs(args);

  if (!parsed.entryPath || !parsed.outDir) {
    io.stderr(
      "Usage: rivet-ts build-local --entry <file> --target <browser|node> --package-name <name> --out <dir>\n",
    );
    return 1;
  }

  if (parsed.target !== "browser" && parsed.target !== "node") {
    io.stderr(`Invalid target "${parsed.target}". Must be "browser" or "node".\n`);
    return 1;
  }

  const config = new BuildLocalConfig({
    entryPath: parsed.entryPath,
    target: parsed.target,
    packageName: parsed.packageName,
    outDir: parsed.outDir,
  });

  const handlerFrontend = new TypeScriptHandlerEntrypointFrontend();
  const contractFrontend = new TypeScriptContractFrontend();
  const lowerer = new TypeScriptRivetContractLowerer();
  const codegen = new LocalClientCodegen();
  const bundler = new EsbuildImplementationBundler();
  const emitter = new LocalPackageEmitter();

  const useCase = new BuildLocalPackage(
    handlerFrontend,
    contractFrontend,
    lowerer,
    codegen,
    bundler,
    emitter,
  );

  const result = await useCase.execute(config);

  for (const diagnostic of result.diagnostics) {
    const location = diagnostic.filePath
      ? `${diagnostic.filePath}${diagnostic.line ? `:${diagnostic.line}:${diagnostic.column}` : ""}`
      : "(unknown)";
    io.stderr(`${diagnostic.severity}: [${diagnostic.code}] ${location} ${diagnostic.message}\n`);
  }

  return result.hasErrors ? 1 : 0;
};

const parseReflectArgs = (args: readonly string[]): { entryPath?: string; outputPath?: string } => {
  let entryPath: string | undefined;
  let outputPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--entry" && index + 1 < args.length) {
      entryPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--out" && index + 1 < args.length) {
      outputPath = args[index + 1];
      index += 1;
    }
  }

  return { entryPath, outputPath };
};

const parseBuildLocalArgs = (
  args: readonly string[],
): {
  entryPath?: string;
  target: BuildLocalTarget;
  packageName: string;
  outDir?: string;
} => {
  let entryPath: string | undefined;
  let target: BuildLocalTarget = "browser";
  let packageName = "@local/handlers";
  let outDir: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--entry" && index + 1 < args.length) {
      entryPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--target" && index + 1 < args.length) {
      target = args[index + 1] as BuildLocalTarget;
      index += 1;
      continue;
    }

    if (arg === "--package-name" && index + 1 < args.length) {
      packageName = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--out" && index + 1 < args.length) {
      outDir = args[index + 1];
      index += 1;
    }
  }

  return { entryPath, target, packageName, outDir };
};
