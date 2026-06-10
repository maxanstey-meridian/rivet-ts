#!/usr/bin/env node

import { runCli } from "./run-cli.js";

const main = async (): Promise<void> => {
  try {
    const exitCode = await runCli(process.argv.slice(2));
    process.exitCode = exitCode;
  } catch (error) {
    // C1: no unhandled rejections with raw internal stack traces from the CLI.
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    process.exitCode = 1;
  }
};

await main();
