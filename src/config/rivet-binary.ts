import os from "node:os";
import path from "node:path";

/** The Rivet release used when neither `rivet.version` nor `RIVET_VERSION` names one. */
export const DEFAULT_RIVET_VERSION = "0.45.1";

export type RivetBinaryConfig = {
  readonly version?: string;
  readonly autoInstall?: boolean;
  readonly binaryPath?: string;
  readonly cacheDir?: string;
};

export type ResolvedRivetBinaryConfig = {
  readonly version: string;
  readonly autoInstall: boolean;
  readonly binaryPath: string | undefined;
  readonly cacheDir: string;
};

const RELEASE_VERSION = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

const readRivetVersion = (): string | undefined => {
  const { RIVET_VERSION } = process.env;
  if (RIVET_VERSION && !RELEASE_VERSION.test(RIVET_VERSION)) {
    throw new Error(
      `RIVET_VERSION must be a Rivet release version such as 0.44.1; got "${RIVET_VERSION}".`,
    );
  }
  return RIVET_VERSION || undefined;
};

const readCacheDir = (): string => {
  const { LOCALAPPDATA, XDG_CACHE_HOME } = process.env;
  const cacheBase =
    process.platform === "win32"
      ? LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Caches")
        : XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(cacheBase, "rivet-ts");
};

/**
 * Explicit config wins over the environment, which wins over the defaults.
 * `RIVET_VERSION` is read (and validated) only when it picks the release: not
 * when `version` is given, nor when `binaryPath` means nothing is installed.
 */
export const resolveRivetBinaryConfig = (
  config: RivetBinaryConfig = {},
): ResolvedRivetBinaryConfig => ({
  version:
    config.version ??
    (config.binaryPath === undefined ? readRivetVersion() : undefined) ??
    DEFAULT_RIVET_VERSION,
  autoInstall: config.autoInstall ?? true,
  binaryPath: config.binaryPath,
  cacheDir: config.cacheDir ?? readCacheDir(),
});
