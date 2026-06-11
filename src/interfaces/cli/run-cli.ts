import fs from "node:fs/promises";
import path from "node:path";
import { LowerTsContractsToRivetContract } from "../../application/use-cases/lower-ts-contracts-to-rivet-contract.js";
import { ScaffoldMockProject } from "../../application/use-cases/scaffold-mock-project.js";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import { ScaffoldMockConfig } from "../../domain/scaffold-mock-config.js";
import { emitClientPackage } from "../../infrastructure/codegen/client-package-emitter.js";
import { FileSystemMockProjectEmitter } from "../../infrastructure/scaffold/mock-project-emitter.js";
import { TypeScriptRivetContractLowerer } from "../../infrastructure/typescript/typescript-rivet-contract-lowerer.js";

type CliIO = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const DEFAULT_IO: CliIO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

const USAGE = [
  "Usage:",
  "  rivet-ts --entry <path> [--out <file>]",
  "  rivet-ts scaffold-mock --entry <file> --out <dir> [--name <project-name>] [--tsconfig <file>]",
  "  rivet-ts generate --generated-root <dir>",
  "",
].join("\n");

const readOwnVersion = async (): Promise<string> => {
  const manifestPath = new URL("../../../package.json", import.meta.url);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { version?: string };
  return manifest.version ?? "unknown";
};

type ParsedFlags = {
  readonly values: ReadonlyMap<string, string>;
  readonly errors: readonly string[];
};

/**
 * Strict flag parser: every argument must be a known flag followed by a value.
 * Unknown flags and flags missing their value are loud errors (C3), never
 * silently ignored.
 */
const parseFlags = (args: readonly string[], knownFlags: readonly string[]): ParsedFlags => {
  const values = new Map<string, string>();
  const errors: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";

    if (!knownFlags.includes(arg)) {
      errors.push(`Unknown argument: ${arg}`);
      continue;
    }

    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      errors.push(`Flag ${arg} is missing a value.`);
      continue;
    }

    values.set(arg, value);
    index += 1;
  }

  return { values, errors };
};

const reportUsageErrors = (errors: readonly string[], io: CliIO): void => {
  for (const error of errors) {
    io.stderr(`error: ${error}\n`);
  }
  io.stderr(USAGE);
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
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout(USAGE);
    return 0;
  }

  if (args.includes("--version")) {
    io.stdout(`${await readOwnVersion()}\n`);
    return 0;
  }

  if (args[0] === "scaffold-mock") {
    return runScaffoldMock(args.slice(1), io);
  }

  if (args[0] === "generate") {
    return runGenerate(args.slice(1), io);
  }

  const parsed = parseFlags(args, ["--entry", "--out"]);

  if (parsed.errors.length > 0) {
    reportUsageErrors(parsed.errors, io);
    return 1;
  }

  const entryPath = parsed.values.get("--entry");
  const outputPath = parsed.values.get("--out");

  if (!entryPath) {
    io.stderr(USAGE);
    return 1;
  }

  const lowerer = new TypeScriptRivetContractLowerer();
  const lowerUseCase = new LowerTsContractsToRivetContract(lowerer);
  const lowered = await lowerUseCase.execute({ entryPath });

  const diagnostics = [...lowered.diagnostics];

  // C4: an entry with zero contracts almost always means a wrong --entry;
  // produce a loud warning instead of silently emitting an empty document.
  if (!lowered.hasErrors && lowered.contracts.length === 0) {
    diagnostics.push(
      new ExtractionDiagnostic({
        severity: "warning",
        code: "ENTRY_NO_CONTRACTS",
        message: "Entry contains no contracts.",
        filePath: path.resolve(entryPath),
      }),
    );
  }

  reportDiagnostics(diagnostics, io);

  const json = `${lowered.toJson()}\n`;

  if (outputPath) {
    // C1: create missing parent directories instead of dying on ENOENT.
    await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await fs.writeFile(outputPath, json, "utf8");
  } else {
    io.stdout(json);
  }

  return lowered.hasErrors ? 1 : 0;
};

const runScaffoldMock = async (args: readonly string[], io: CliIO): Promise<number> => {
  const parsed = parseFlags(args, ["--entry", "--out", "--name", "--tsconfig"]);

  if (parsed.errors.length > 0) {
    reportUsageErrors(parsed.errors, io);
    return 1;
  }

  const entryPath = parsed.values.get("--entry");
  const outDir = parsed.values.get("--out");
  const projectName = parsed.values.get("--name");
  const tsconfigPath = parsed.values.get("--tsconfig");

  if (!entryPath || !outDir) {
    io.stderr(USAGE);
    return 1;
  }

  const lowerer = new TypeScriptRivetContractLowerer(tsconfigPath);
  const emitter = new FileSystemMockProjectEmitter();
  const useCase = new ScaffoldMockProject(lowerer, emitter);

  const result = await useCase.execute(
    new ScaffoldMockConfig({
      entryPath,
      outDir,
      projectName,
      tsconfigPath,
    }),
  );

  reportDiagnostics(result.diagnostics, io);

  return result.hasErrors ? 1 : 0;
};

const runGenerate = async (args: readonly string[], io: CliIO): Promise<number> => {
  const parsed = parseFlags(args, ["--generated-root"]);

  if (parsed.errors.length > 0) {
    reportUsageErrors(parsed.errors, io);
    return 1;
  }

  const generatedRoot = parsed.values.get("--generated-root");

  if (!generatedRoot) {
    io.stderr(USAGE);
    return 1;
  }

  try {
    await emitClientPackage(generatedRoot);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`${message}\n`);
    return 1;
  }
};
