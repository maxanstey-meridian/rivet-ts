import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { resolveRivetBinaryConfig } from "./config/rivet-binary.js";
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
import { readPackageManifest } from "./infrastructure/scaffold/workspace-emitter.js";
import { lowerContracts } from "./infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { ensureRivetBinary } from "./infrastructure/vite/rivet-binary.js";
import { formatDiagnostic } from "./interfaces/diagnostics.js";

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

const isUsageError = (error: unknown): error is Error =>
  error instanceof TypeError &&
  "code" in error &&
  typeof error.code === "string" &&
  error.code.startsWith("ERR_PARSE_ARGS_");

const reportDiagnostics = (diagnostics: readonly ExtractionDiagnostic[], io: CliIO): void => {
  for (const diagnostic of diagnostics) {
    io.stderr(`${formatDiagnostic(diagnostic)}\n`);
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
    io.stdout(`${(await readPackageManifest()).version ?? "unknown"}\n`);
    return 0;
  }

  try {
    switch (args[0]) {
      case "scaffold":
        return await runScaffold(args.slice(1), io);
      case "scaffold-mock":
        return await runScaffoldMock(args.slice(1), io);
      case "generate":
        return await runGenerate(args.slice(1), io);
      default:
        return await runLower(args, io);
    }
  } catch (error) {
    if (isUsageError(error)) {
      io.stderr(`error: ${error.message}\n${USAGE}`);
      return 1;
    }
    throw error;
  }
};

const runLower = async (args: readonly string[], io: CliIO): Promise<number> => {
  const { values } = parseArgs({
    args: [...args],
    options: {
      entry: { type: "string" },
      out: { type: "string" },
      tsconfig: { type: "string" },
    },
    strict: true,
  });
  const entryPath = values.entry;
  const outputPath = values.out;

  if (!entryPath) {
    io.stderr(USAGE);
    return 1;
  }

  const lowered = lowerContracts(entryPath, { tsconfigPath: values.tsconfig });

  const diagnostics = [...lowered.diagnostics];

  // An entry with zero contracts almost always means a wrong --entry;
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
    await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await fs.writeFile(outputPath, json, "utf8");
  } else {
    io.stdout(json);
  }

  return lowered.hasErrors ? 1 : 0;
};

const runScaffoldMock = async (args: readonly string[], io: CliIO): Promise<number> => {
  const { values } = parseArgs({
    args: [...args],
    options: {
      entry: { type: "string" },
      out: { type: "string" },
      name: { type: "string" },
      tsconfig: { type: "string" },
      spec: { type: "string" },
      force: { type: "boolean", default: false },
    },
    strict: true,
  });
  const {
    entry: entryPath,
    out: outDir,
    name: projectName,
    tsconfig: tsconfigPath,
    spec: specPath,
  } = values;

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
      force: values.force,
      contracts: lowered.contracts,
      sourceFiles: lowered.sourceFiles,
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
  const { values } = parseArgs({
    args: [...args],
    options: {
      out: { type: "string" },
      name: { type: "string" },
      force: { type: "boolean", default: false },
      "no-api": { type: "boolean", default: false },
    },
    strict: true,
  });
  const outDir = values.out;

  if (!outDir) {
    io.stderr(USAGE);
    return 1;
  }

  const projectName = values.name ?? path.basename(path.resolve(outDir));

  try {
    if (values["no-api"]) {
      await emitFrontendOnlyProject({
        outDir,
        projectName,
        force: values.force,
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
      force: values.force,
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
  const { values } = parseArgs({
    args: [...args],
    options: { "generated-root": { type: "string" } },
    strict: true,
  });
  const generatedRoot = values["generated-root"];

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
  const executablePath = await ensureRivetBinary(resolveRivetBinaryConfig());

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
 * that is never on PATH.
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
