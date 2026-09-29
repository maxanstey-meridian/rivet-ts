import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfiguredRivetVersion, resolveRivetBinaryConfig } from "./config/rivet-binary.js";
import { ExtractionDiagnostic } from "./domain/diagnostic.js";
import { emitClientPackage } from "./infrastructure/codegen/client-package-emitter.js";
import {
  EXAMPLE_CONTRACTS_PATH,
  emitExampleProject,
  emitFrontendOnlyProject,
} from "./infrastructure/scaffold/example-project-emitter.js";
import { emitMockProject } from "./infrastructure/scaffold/mock-project-emitter.js";
import {
  enrichDocumentWithConstraints,
  readOpenApiConstraints,
} from "./infrastructure/scaffold/openapi-constraint-reader.js";
import { lowerContracts } from "./infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { ensureRivetBinary } from "./infrastructure/vite/rivet-binary.js";

export type CliIO = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const DEFAULT_IO: CliIO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

const USAGE = [
  "Usage:",
  "  rivet-ts --entry <path> [--out <file>] [--tsconfig <file>]",
  "  rivet-ts scaffold --out <dir> [--name <project-name>] [--no-api] [--force]",
  "  rivet-ts scaffold-mock --entry <file> --out <dir> [--name <project-name>] [--tsconfig <file>] [--spec <openapi.json>] [--force]",
  "  rivet-ts generate --generated-root <dir>",
  "  rivet-ts rivet [--] <args passed to the Rivet binary>",
  "",
].join("\n");

const readOwnVersion = async (): Promise<string> => {
  const manifestPath = new URL("../package.json", import.meta.url);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { version?: string };
  return manifest.version ?? "unknown";
};

type ParsedFlags = {
  readonly values: ReadonlyMap<string, string>;
  readonly switches: ReadonlySet<string>;
  readonly errors: readonly string[];
};

/**
 * Strict flag parser: every argument must be a known flag. Valued flags take
 * the next argument; switches stand alone. Unknown flags and valued flags
 * missing their value are loud errors (C3), never silently ignored.
 */
const parseFlags = (
  args: readonly string[],
  knownFlags: readonly string[],
  knownSwitches: readonly string[] = [],
): ParsedFlags => {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const errors: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";

    if (knownSwitches.includes(arg)) {
      switches.add(arg);
      continue;
    }

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

  return { values, switches, errors };
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
  // Everything after `rivet` belongs to the Rivet binary, including --help/--version.
  if (args[0] === "rivet") {
    return runRivetPassthrough(args.slice(1), io);
  }

  if (args.includes("--help") || args.includes("-h")) {
    io.stdout(USAGE);
    return 0;
  }

  if (args.includes("--version")) {
    io.stdout(`${await readOwnVersion()}\n`);
    return 0;
  }

  if (args[0] === "scaffold") {
    return runScaffold(args.slice(1), io);
  }

  if (args[0] === "scaffold-mock") {
    return runScaffoldMock(args.slice(1), io);
  }

  if (args[0] === "generate") {
    return runGenerate(args.slice(1), io);
  }

  const parsed = parseFlags(args, ["--entry", "--out", "--tsconfig"]);

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

  const lowered = lowerContracts(entryPath, { tsconfigPath: parsed.values.get("--tsconfig") });

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
  const parsed = parseFlags(
    args,
    ["--entry", "--out", "--name", "--tsconfig", "--spec"],
    ["--force"],
  );

  if (parsed.errors.length > 0) {
    reportUsageErrors(parsed.errors, io);
    return 1;
  }

  const entryPath = parsed.values.get("--entry");
  const outDir = parsed.values.get("--out");
  const projectName = parsed.values.get("--name");
  const tsconfigPath = parsed.values.get("--tsconfig");
  const specPath = parsed.values.get("--spec");

  if (!entryPath || !outDir) {
    io.stderr(USAGE);
    return 1;
  }

  let spec: unknown;
  if (specPath) {
    try {
      spec = JSON.parse(await fs.readFile(specPath, "utf8")) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      io.stderr(`error: could not read OpenAPI spec at ${specPath}: ${message}\n`);
      return 1;
    }
  }

  try {
    const lowered = lowerContracts(entryPath, { tsconfigPath });
    reportDiagnostics(lowered.diagnostics, io);
    if (lowered.hasErrors) {
      return 1;
    }

    await emitMockProject({
      outDir,
      projectName: projectName ?? path.basename(outDir),
      entryPath,
      force: parsed.switches.has("--force"),
      contracts: lowered.contracts,
      // A spec carries JSON Schema constraints the TS contract cannot express.
      document:
        spec === undefined
          ? lowered.document
          : enrichDocumentWithConstraints(lowered.document, readOpenApiConstraints(spec)),
    });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`error: ${message}\n`);
    return 1;
  }
};

/**
 * Stages the example contract entry in a temp project whose tsconfig maps
 * "rivet-ts" onto this package's own type surface, so the entry lowers through
 * the REAL pipeline before rivet-ts is installed anywhere. The scaffolded
 * bootstrap artifacts therefore can never drift from what the emitted
 * contracts.ts actually declares.
 */
const lowerExampleEntry = async () => {
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-scaffold-"));

  try {
    // ../ is the package root from both src/ (tests run the TS directly) and
    // dist/ (the shipped CLI).
    const packageTypesPath = fileURLToPath(new URL("../dist/index.d.ts", import.meta.url));
    const entryPath = path.join(stagingDir, "contracts.ts");
    const tsconfigPath = path.join(stagingDir, "tsconfig.json");

    await fs.copyFile(EXAMPLE_CONTRACTS_PATH, entryPath);
    await fs.writeFile(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            baseUrl: ".",
            paths: { "rivet-ts": [packageTypesPath] },
          },
          include: ["contracts.ts"],
        },
        null,
        2,
      ),
    );

    return lowerContracts(entryPath, { tsconfigPath });
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const runScaffold = async (args: readonly string[], io: CliIO): Promise<number> => {
  const parsed = parseFlags(args, ["--out", "--name"], ["--force", "--no-api"]);

  if (parsed.errors.length > 0) {
    reportUsageErrors(parsed.errors, io);
    return 1;
  }

  const outDir = parsed.values.get("--out");

  if (!outDir) {
    io.stderr(USAGE);
    return 1;
  }

  const projectName = parsed.values.get("--name") ?? path.basename(path.resolve(outDir));

  try {
    if (parsed.switches.has("--no-api")) {
      await emitFrontendOnlyProject({
        outDir,
        projectName,
        force: parsed.switches.has("--force"),
      });

      io.stdout(`Scaffolded ${projectName} (frontend-only) into ${outDir}.\n`);
      io.stdout("Point task generate at your API, then: task install && task dev.\n");
      return 0;
    }

    const lowered = await lowerExampleEntry();
    reportDiagnostics(lowered.diagnostics, io);

    if (lowered.hasErrors) {
      io.stderr("error: the example contract entry failed to lower; this is a rivet-ts bug.\n");
      return 1;
    }

    await emitExampleProject({
      outDir,
      projectName,
      force: parsed.switches.has("--force"),
      document: lowered.document,
    });

    io.stdout(`Scaffolded ${projectName} into ${outDir}.\n`);
    io.stdout("Next: task install && task dev (see README.md).\n");
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`error: ${message}\n`);
    return 1;
  }
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

const runRivet = async (args: readonly string[], io: CliIO): Promise<number> => {
  const version = getConfiguredRivetVersion();
  const executablePath = await ensureRivetBinary(
    resolveRivetBinaryConfig(version ? { version } : undefined),
  );

  return new Promise<number>((resolve) => {
    const child = spawn(executablePath, args, { stdio: ["inherit", "pipe", "pipe"] });
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

/**
 * Resolves the cached Rivet binary (auto-installing on first use, exactly as
 * the vite plugin does) and passes the remaining arguments through verbatim.
 * Scaffolded `task generate` pipelines call this instead of a bare `rivet`
 * that is never on PATH (GAPS 5.1 exit-127).
 */
const runRivetPassthrough = async (args: readonly string[], io: CliIO): Promise<number> => {
  const passthroughArgs = args[0] === "--" ? args.slice(1) : [...args];

  try {
    return await runRivet(passthroughArgs, io);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`error: ${message}\n`);
    return 1;
  }
};
