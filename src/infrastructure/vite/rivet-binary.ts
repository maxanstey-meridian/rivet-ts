import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import type { ResolvedRivetBinaryConfig } from "../../config/rivet-binary.js";

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

const ensureOk = async (response: Response, message: string): Promise<void> => {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${message} (${response.status} ${response.statusText})${body ? `\n${body}` : ""}`,
    );
  }
};

const verifyDigest = async (filePath: string, expectedSha256: string): Promise<void> => {
  const actual = createHash("sha256")
    .update(await fs.readFile(filePath))
    .digest("hex");

  if (actual !== expectedSha256) {
    throw new Error(
      `Downloaded Rivet binary digest mismatch. Expected sha256:${expectedSha256}, got sha256:${actual}.`,
    );
  }
};

type GitHubReleaseAsset = {
  readonly name: string;
  readonly digest?: string;
  readonly browser_download_url: string;
};

type GitHubRelease = {
  readonly assets: readonly GitHubReleaseAsset[];
};

const SHA256_DIGEST = /^sha256:([0-9a-f]{64})$/u;

const resolveReleaseAsset = async (
  tagName: string,
  assetName: string,
): Promise<{ readonly downloadUrl: string; readonly sha256: string }> => {
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

  const sha256 = SHA256_DIGEST.exec(asset.digest ?? "")?.[1];
  if (!sha256) {
    throw new Error(
      `Release ${tagName} asset ${assetName} publishes no sha256 digest, so the download cannot be verified. ` +
        "Install Rivet yourself and set rivet.binaryPath.",
    );
  }

  return { downloadUrl: asset.browser_download_url, sha256 };
};

export const ensureRivetBinary = async (config: ResolvedRivetBinaryConfig): Promise<string> => {
  // An explicit binary skips rid resolution, so self-built binaries work on
  // platforms outside the release matrix.
  if (config.binaryPath) {
    return path.resolve(config.binaryPath);
  }

  const tagName = normalizeTagName(config.version);
  const rid = resolveRid();
  const executableName = process.platform === "win32" ? `rivet-${rid}.exe` : `rivet-${rid}`;
  const cacheRoot = path.resolve(config.cacheDir);
  const installDirectory = path.join(cacheRoot, "rivet", tagName, rid);
  const executablePath = path.join(installDirectory, executableName);

  try {
    await fs.access(executablePath);
    return executablePath;
  } catch {
    if (!config.autoInstall) {
      throw new Error(
        `Rivet binary not found at ${executablePath}. Set rivet.binaryPath or enable auto-install.`,
      );
    }
  }

  // Download + extract into a temp sibling, verify, then atomically rename
  // into place: a process dying mid-extraction must not leave a
  // truncated-but-present executable that passes the access() check forever,
  // and concurrent vite processes must not race each other's extraction.
  const stagingDirectory = `${installDirectory}.tmp-${process.pid}`;
  await fs.rm(stagingDirectory, { recursive: true, force: true });
  await fs.mkdir(stagingDirectory, { recursive: true });

  try {
    const assetName = `rivet-${rid}.tar.gz`;
    const asset = await resolveReleaseAsset(tagName, assetName);
    const archivePath = path.join(stagingDirectory, assetName);
    const downloadResponse = await fetch(asset.downloadUrl, {
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
      createWriteStream(archivePath),
    );
    await verifyDigest(archivePath, asset.sha256);

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

  return executablePath;
};
