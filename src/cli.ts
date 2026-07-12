import { execFile } from "node:child_process";
import { getConfiguredRivetVersion, resolveRivetBinaryConfig } from "./config/rivet-binary.js";
import { emitClientPackage } from "./infrastructure/codegen/client-package-emitter.js";
import {
  EXAMPLE_CONTRACTS_SOURCE,
  emitExampleProject,
  emitFrontendOnlyProject,
} from "./infrastructure/scaffold/example-project-emitter.js";
import { FileSystemMockProjectEmitter } from "./infrastructure/scaffold/mock-project-emitter.js";
import {
  ConstraintEnrichingMockProjectEmitter,
  readOpenApiConstraints,
} from "./infrastructure/scaffold/openapi-constraint-reader.js";
import { TypeScriptRivetContractLowerer } from "./infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { ensureRivetBinary } from "./infrastructure/vite/rivet-binary.js";
import { createRunCli, type CliIO } from "./interfaces/cli/run-cli.js";

const runRivet = async (args: readonly string[], io: CliIO): Promise<number> => {
  const version = getConfiguredRivetVersion();
  const binary = await ensureRivetBinary(
    resolveRivetBinaryConfig(version ? { version } : undefined),
  );

  return new Promise<number>((resolve) => {
    const child = execFile(binary.executablePath, [...args]);
    child.stdout?.on("data", (chunk: string | Buffer) => io.stdout(chunk.toString()));
    child.stderr?.on("data", (chunk: string | Buffer) => io.stderr(chunk.toString()));
    child.on("error", (error) => {
      io.stderr(`${error.message}\n`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
};

export const runCli = createRunCli({
  createLowerer: (tsconfigPath) => new TypeScriptRivetContractLowerer(tsconfigPath),
  createMockProjectEmitter: (spec) => {
    const emitter = new FileSystemMockProjectEmitter();
    return spec === undefined
      ? emitter
      : new ConstraintEnrichingMockProjectEmitter(emitter, readOpenApiConstraints(spec));
  },
  exampleContractsSource: EXAMPLE_CONTRACTS_SOURCE,
  emitExampleProject,
  emitFrontendOnlyProject,
  emitClientPackage: (generatedRoot) => emitClientPackage(generatedRoot),
  runRivet,
});
