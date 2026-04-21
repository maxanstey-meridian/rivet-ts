import fs from "node:fs/promises";
import { ExtractTsContracts } from "../../application/use-cases/extract-ts-contracts.js";
import { LowerContractBundleToRivetContract } from "../../application/use-cases/lower-contract-bundle-to-rivet-contract.js";
import { ScaffoldMockProject } from "../../application/use-cases/scaffold-mock-project.js";
import type { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import { ScaffoldMockConfig } from "../../domain/scaffold-mock-config.js";
import { emitClientPackage } from "../../infrastructure/codegen/client-package-emitter.js";
import { FileSystemMockProjectEmitter } from "../../infrastructure/scaffold/mock-project-emitter.js";
import { TypeScriptContractFrontend } from "../../infrastructure/typescript/typescript-contract-frontend.js";
import { TypeScriptRivetContractLowerer } from "../../infrastructure/typescript/typescript-rivet-contract-lowerer.js";

type CliIO = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const DEFAULT_IO: CliIO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

const reportDiagnostics = (diagnostics: readonly ExtractionDiagnostic[], io: CliIO): void => {
  for (const diagnostic of diagnostics) {
    const location = diagnostic.filePath
      ? `${diagnostic.filePath}${diagnostic.line ? `:${diagnostic.line}:${diagnostic.column}` : ""}`
      : "(unknown)";
    io.stderr(`${diagnostic.severity}: [${diagnostic.code}] ${location} ${diagnostic.message}\n`);
  }
};

export const runCli = async (args: readonly string[], io: CliIO = DEFAULT_IO): Promise<number> => {
  if (args[0] === "scaffold-mock") {
    return runScaffoldMock(args.slice(1), io);
  }

  if (args[0] === "generate") {
    return runGenerate(args.slice(1), io);
  }

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

  reportDiagnostics(lowered.diagnostics, io);

  const json = `${lowered.toJson()}\n`;

  if (parsed.outputPath) {
    await fs.writeFile(parsed.outputPath, json, "utf8");
  } else {
    io.stdout(json);
  }

  return lowered.hasErrors ? 1 : 0;
};

const runScaffoldMock = async (args: readonly string[], io: CliIO): Promise<number> => {
  const parsed = parseScaffoldMockArgs(args);

  if (!parsed.entryPath || !parsed.outDir) {
    io.stderr(
      "Usage: rivet-ts scaffold-mock --entry <file> --out <dir> [--name <project-name>] [--tsconfig <file>]\n",
    );
    return 1;
  }

  const frontend = new TypeScriptContractFrontend(parsed.tsconfigPath);
  const lowerer = new TypeScriptRivetContractLowerer(parsed.tsconfigPath);
  const emitter = new FileSystemMockProjectEmitter();
  const useCase = new ScaffoldMockProject(frontend, lowerer, emitter);

  const result = await useCase.execute(
    new ScaffoldMockConfig({
      entryPath: parsed.entryPath,
      outDir: parsed.outDir,
      projectName: parsed.projectName,
      tsconfigPath: parsed.tsconfigPath,
    }),
  );

  reportDiagnostics(result.diagnostics, io);

  return result.hasErrors ? 1 : 0;
};

const runGenerate = async (args: readonly string[], io: CliIO): Promise<number> => {
  const parsed = parseGenerateArgs(args);

  if (!parsed.generatedRoot) {
    io.stderr("Usage: rivet-ts generate --generated-root <dir>\n");
    return 1;
  }

  try {
    await emitClientPackage(parsed.generatedRoot);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`${message}\n`);
    return 1;
  }
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

const parseScaffoldMockArgs = (
  args: readonly string[],
): {
  entryPath?: string;
  outDir?: string;
  projectName?: string;
  tsconfigPath?: string;
} => {
  let entryPath: string | undefined;
  let outDir: string | undefined;
  let projectName: string | undefined;
  let tsconfigPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--entry" && index + 1 < args.length) {
      entryPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--out" && index + 1 < args.length) {
      outDir = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--name" && index + 1 < args.length) {
      projectName = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--tsconfig" && index + 1 < args.length) {
      tsconfigPath = args[index + 1];
      index += 1;
    }
  }

  return { entryPath, outDir, projectName, tsconfigPath };
};

const parseGenerateArgs = (
  args: readonly string[],
): {
  generatedRoot?: string;
} => {
  let generatedRoot: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--generated-root" && index + 1 < args.length) {
      generatedRoot = args[index + 1];
      index += 1;
    }
  }

  return { generatedRoot };
};
