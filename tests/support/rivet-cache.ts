import fs from "node:fs/promises";
import path from "node:path";
import { tempDir } from "./temp.js";

export const FAKE_RIVET_VERSION = "0.0.0-fake";

const RIDS: Record<string, string> = {
  "darwin-arm64": "osx-arm64",
  "darwin-x64": "osx-x64",
  "linux-x64": "linux-x64",
};

export const currentRid = (): string => {
  const rid = RIDS[`${process.platform}-${process.arch}`];
  if (!rid) {
    throw new Error(`No Rivet rid for ${process.platform}-${process.arch}.`);
  }
  return rid;
};

/**
 * Points the product's binary cache at a throwaway HOME and pins
 * RIVET_VERSION to the fake release, then returns where the product will look
 * for the executable. Callers must `vi.unstubAllEnvs()` after the test.
 */
export const useThrowawayRivetCache = async (): Promise<string> => {
  const home = await tempDir("rivet-ts-rivet-cache-");
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_CACHE_HOME", path.join(home, ".cache"));
  vi.stubEnv("RIVET_VERSION", FAKE_RIVET_VERSION);

  const rid = currentRid();
  const cacheRoot =
    process.platform === "darwin"
      ? path.join(home, "Library", "Caches", "rivet-ts")
      : path.join(home, ".cache", "rivet-ts");
  return path.join(cacheRoot, "rivet", `v${FAKE_RIVET_VERSION}`, rid, `rivet-${rid}`);
};

/** Seeds the throwaway cache with a Node script standing in for a downloaded Rivet release. */
export const installFakeRivet = async (source: string): Promise<string> => {
  const executablePath = await useThrowawayRivetCache();
  await fs.mkdir(path.dirname(executablePath), { recursive: true });
  await fs.writeFile(executablePath, `#!/usr/bin/env node\n${source}\n`);
  await fs.chmod(executablePath, 0o755);
  return executablePath;
};
