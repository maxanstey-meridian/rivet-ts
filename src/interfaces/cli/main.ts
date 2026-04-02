#!/usr/bin/env node

import { runCli } from "./run-cli.js";

const main = async (): Promise<void> => {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
};

await main();
