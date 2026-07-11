import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";

const DEFAULT_RIVET_REPOSITORY = {
  owner: "maxanstey-meridian",
  repo: "rivet",
} as const;

const normalizeTagName = (version: string): string =>
  version.startsWith("v") ? version : `v${version}`;

const resolveRid = (): string => {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "osx-arm64";
  }

  if (process.platform === "darwin" && process.arch === "x64") {
    return "osx-x64";
  }

  if (process.platform === "linux" && process.arch === "x64") {
    return "linux-x64";
  }

  if (process.platform === "win32" && process.arch === "x64") {
    return "win-x64";
  }

  throw new Error(
    `Unsupported platform for Rivet binary auto-install: ${process.platform} ${process.arch}.`,
  );
};

const getDefaultCacheRoot = (): string => {
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

const ensureOk = async (response: Response, message: string): Promise<void> => {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${message} (${response.status} ${response.statusText})${body ? `\n${body}` : ""}`,
    );
  }
};

const verifyDigest = async (filePath: string, expectedDigest: string): Promise<void> => {
  const expected = expectedDigest.replace(/^sha256:/u, "");
  const buffer = await fs.readFile(filePath);
  const actual = createHash("sha256").update(buffer).digest("hex");

  if (actual !== expected) {
    throw new Error(
      `Downloaded Rivet binary digest mismatch. Expected ${expectedDigest}, got sha256:${actual}.`,
    );
  }
};

export type ResolvedRivetBinary = {
  readonly executablePath: string;
  readonly version: string;
  readonly rid: string;
};

export type RivetBinaryConfig = {
  readonly version?: string;
  readonly autoInstall?: boolean;
  readonly binaryPath?: string;
  readonly cacheDir?: string;
};

type GitHubReleaseAsset = {
  readonly name: string;
  readonly digest?: string;
  readonly browser_download_url: string;
};

type GitHubRelease = {
  readonly assets: readonly GitHubReleaseAsset[];
};

const downloadReleaseAsset = async (
  tagName: string,
  assetName: string,
): Promise<GitHubReleaseAsset> => {
  const releaseUrl = `https://api.github.com/repos/${DEFAULT_RIVET_REPOSITORY.owner}/${DEFAULT_RIVET_REPOSITORY.repo}/releases/tags/${tagName}`;
  const releaseResponse = await fetch(releaseUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "rivet-ts/vite",
    },
  });
  await ensureOk(releaseResponse, `Failed to resolve Rivet release ${tagName}`);

  const release = (await releaseResponse.json()) as GitHubRelease;
  const asset = release.assets.find((candidate) => candidate.name === assetName);

  if (!asset) {
    throw new Error(`Release ${tagName} does not contain asset ${assetName}.`);
  }

  return asset;
};

export const ensureRivetBinary = async (
  config: RivetBinaryConfig | undefined,
): Promise<ResolvedRivetBinary> => {
  if (config?.binaryPath) {
    // The rid is informational on this branch; resolving it eagerly would
    // reject self-built binaries on platforms outside the release matrix —
    // the exact users the escape hatch exists for (B1).
    let rid: string;
    try {
      rid = resolveRid();
    } catch {
      rid = `${process.platform}-${process.arch}`;
    }
    return {
      executablePath: path.resolve(config.binaryPath),
      version: config.version ?? "manual",
      rid,
    };
  }

  const autoInstall = config?.autoInstall ?? true;
  const version = config?.version ?? "0.40.0";
  const tagName = normalizeTagName(version);
  const rid = resolveRid();
  const executableName = process.platform === "win32" ? `rivet-${rid}.exe` : `rivet-${rid}`;
  const cacheRoot = config?.cacheDir ? path.resolve(config.cacheDir) : getDefaultCacheRoot();
  const installDirectory = path.join(cacheRoot, "rivet", tagName, rid);
  const executablePath = path.join(installDirectory, executableName);

  try {
    await fs.access(executablePath);
    return {
      executablePath,
      version,
      rid,
    };
  } catch {
    if (!autoInstall) {
      throw new Error(
        `Rivet binary not found at ${executablePath}. Set rivet.binaryPath or enable auto-install.`,
      );
    }
  }

  // Download + extract into a temp sibling, verify, then atomically rename
  // into place (B2): a process dying mid-extraction must not leave a
  // truncated-but-present executable that passes the access() check forever,
  // and concurrent vite processes must not race each other's extraction.
  const stagingDirectory = `${installDirectory}.tmp-${process.pid}`;
  await fs.rm(stagingDirectory, { recursive: true, force: true });
  await fs.mkdir(stagingDirectory, { recursive: true });

  try {
    const assetName = `rivet-${rid}.tar.gz`;
    const asset = await downloadReleaseAsset(tagName, assetName);
    const archivePath = path.join(stagingDirectory, asset.name);
    const downloadResponse = await fetch(asset.browser_download_url, {
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "rivet-ts/vite",
      },
    });
    await ensureOk(downloadResponse, `Failed to download Rivet asset ${assetName}`);

    if (!downloadResponse.body) {
      throw new Error(`Download for ${assetName} returned an empty body.`);
    }

    await pipeline(
      Readable.fromWeb(downloadResponse.body as globalThis.ReadableStream),
      await fs.open(archivePath, "w").then((handle) => handle.createWriteStream()),
    );

    if (asset.digest) {
      await verifyDigest(archivePath, asset.digest);
    }

    await tar.x({
      file: archivePath,
      cwd: stagingDirectory,
    });

    const stagedExecutable = path.join(stagingDirectory, executableName);
    await fs.access(stagedExecutable).catch(() => {
      throw new Error(`Archive ${assetName} did not contain ${executableName}.`);
    });

    if (process.platform !== "win32") {
      await fs.chmod(stagedExecutable, 0o755);
    }

    await fs.unlink(archivePath).catch(() => undefined);
    await fs.mkdir(path.dirname(installDirectory), { recursive: true });
    try {
      await fs.rename(stagingDirectory, installDirectory);
    } catch {
      // A concurrent process won the rename; use its install if it's whole.
      await fs.access(executablePath);
    }
  } finally {
    await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }

  return {
    executablePath,
    version,
    rid,
  };
};
