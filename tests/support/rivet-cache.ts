import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
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

export type FakeReleaseDigest = "matching" | "wrong" | "missing";

/**
 * Empties the throwaway cache and fakes GitHub (release API and asset
 * download) to serve a release whose executable is a Node script running
 * `source`, published with a `digest` that matches the archive, is wrong, or
 * is missing. Returns where the product will install the executable. Callers
 * must `vi.unstubAllEnvs()` and `vi.unstubAllGlobals()` after the test.
 */
export const serveFakeRivetRelease = async (
  source: string,
  digest: FakeReleaseDigest,
): Promise<string> => {
  const executablePath = await useThrowawayRivetCache();
  const rid = currentRid();
  const staging = await tempDir("rivet-ts-release-");
  await fs.writeFile(path.join(staging, `rivet-${rid}`), `#!/usr/bin/env node\n${source}\n`);
  const archivePath = path.join(staging, `rivet-${rid}.tar.gz`);
  await tar.c({ gzip: true, file: archivePath, cwd: staging }, [`rivet-${rid}`]);
  const archive = await fs.readFile(archivePath);
  const sha256 = createHash("sha256").update(archive).digest("hex");

  const asset = {
    name: `rivet-${rid}.tar.gz`,
    browser_download_url: `https://downloads.invalid/rivet-${rid}.tar.gz`,
    ...(digest === "missing"
      ? {}
      : { digest: `sha256:${digest === "matching" ? sha256 : "0".repeat(64)}` }),
  };
  vi.stubGlobal("fetch", async (url: string) =>
    url.startsWith("https://api.github.com/")
      ? Response.json({ assets: [asset] })
      : new Response(archive),
  );
  return executablePath;
};
