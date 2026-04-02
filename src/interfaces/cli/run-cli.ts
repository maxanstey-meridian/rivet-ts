import fs from "node:fs/promises";

import { ExtractTsContracts } from "../../application/use-cases/extract-ts-contracts.js";
import { TypeScriptContractFrontend } from "../../infrastructure/typescript/typescript-contract-frontend.js";

type CliIO = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const DEFAULT_IO: CliIO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export const runCli = async (args: readonly string[], io: CliIO = DEFAULT_IO): Promise<number> => {
  const parsed = parseArgs(args);

  if (!parsed.entryPath) {
    io.stderr("Usage: rivet-reflect-ts --entry <path> [--out <file>]\n");
    return 1;
  }

  const frontend = new TypeScriptContractFrontend();
  const useCase = new ExtractTsContracts(frontend);
  const bundle = await useCase.execute({ entryPath: parsed.entryPath });

  for (const diagnostic of bundle.diagnostics) {
    const location = diagnostic.filePath
      ? `${diagnostic.filePath}${diagnostic.line ? `:${diagnostic.line}:${diagnostic.column}` : ""}`
      : "(unknown)";
    io.stderr(`${diagnostic.severity}: [${diagnostic.code}] ${location} ${diagnostic.message}\n`);
  }

  const json = `${JSON.stringify(bundle, null, 2)}\n`;

  if (parsed.outputPath) {
    await fs.writeFile(parsed.outputPath, json, "utf8");
  } else {
    io.stdout(json);
  }

  return bundle.hasErrors ? 1 : 0;
};

const parseArgs = (args: readonly string[]): { entryPath?: string; outputPath?: string } => {
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
