import { runCli } from "../../src/cli.js";

export type CapturedCliRun = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export const runCliCaptured = async (args: readonly string[]): Promise<CapturedCliRun> => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runCli(args, {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  });
  return { exitCode, stdout: stdout.join(""), stderr: stderr.join("") };
};
