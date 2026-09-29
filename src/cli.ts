import { spawn } from "node:child_process";
import os from "node:os";
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
    const child = spawn(binary.executablePath, args, { stdio: ["inherit", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8").on("data", io.stdout);
    child.stderr.setEncoding("utf8").on("data", io.stderr);
    child.on("error", (error) => {
      io.stderr(`${error.message}\n`);
      resolve(1);
    });
    child.on("close", (code, signal) =>
      resolve(code ?? (signal ? 128 + os.constants.signals[signal] : 1)),
    );
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
