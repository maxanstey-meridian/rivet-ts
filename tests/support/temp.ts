import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** A real-path temp dir; the caller owns its removal. Prefer `tempDir` inside a test. */
export const makeTempDir = async (prefix = "rivet-ts-"): Promise<string> =>
  fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));

export const removeDir = (dir: string): Promise<void> =>
  fs.rm(dir, { recursive: true, force: true });

/** A real-path temp dir removed when the current test finishes. */
export const tempDir = async (prefix?: string): Promise<string> => {
  const dir = await makeTempDir(prefix);
  onTestFinished(() => removeDir(dir));
  return dir;
};
