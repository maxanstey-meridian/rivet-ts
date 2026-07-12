import os from "node:os";
import path from "node:path";

export const getDefaultRivetCacheRoot = (): string => {
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "rivet-ts")
      : path.join(os.homedir(), "AppData", "Local", "rivet-ts");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "rivet-ts");
  }

  return process.env.XDG_CACHE_HOME
    ? path.join(process.env.XDG_CACHE_HOME, "rivet-ts")
    : path.join(os.homedir(), ".cache", "rivet-ts");
};

export const getConfiguredRivetVersion = (): string | undefined => process.env.RIVET_VERSION;

export const resolveRivetBinaryConfig = <T extends object>(
  config: T | undefined,
): T & { readonly cacheDir: string } =>
  Object.assign({}, config ?? ({} as T), {
    cacheDir:
      (config as { readonly cacheDir?: string } | undefined)?.cacheDir ??
      getDefaultRivetCacheRoot(),
  });
