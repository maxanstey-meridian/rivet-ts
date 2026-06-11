import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const getProjectRoot = (): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "..");
};

/**
 * Makes a scaffolded workspace resolvable offline: every top-level entry of
 * this repo's node_modules is linked into the scaffold's node_modules, plus
 * rivet-ts itself → this repo (so the emitted code typechecks against the
 * CURRENT runtime, not the pinned GitHub tag).
 */
export const linkScaffoldDependencies = async (outputDirectory: string): Promise<void> => {
  const projectRoot = getProjectRoot();
  const sourceModules = path.join(projectRoot, "node_modules");
  const targetModules = path.join(outputDirectory, "node_modules");
  await fs.mkdir(targetModules, { recursive: true });

  for (const entry of await fs.readdir(sourceModules)) {
    if (entry.startsWith(".") || entry === "rivet-ts") {
      continue;
    }
    await fs
      .symlink(path.join(sourceModules, entry), path.join(targetModules, entry), "dir")
      .catch(() => undefined);
  }

  await fs
    .symlink(projectRoot, path.join(targetModules, "rivet-ts"), "dir")
    .catch(() => undefined);
};

const runTsc = async (tsconfigPath: string): Promise<void> => {
  const tscPath = path.join(getProjectRoot(), "node_modules", ".bin", "tsc");

  try {
    await execFileAsync(tscPath, ["--noEmit", "-p", tsconfigPath]);
  } catch (error: unknown) {
    const failure = error as { stdout?: string; stderr?: string };
    throw new Error(
      `Scaffolded package failed tsc --noEmit (${tsconfigPath}):\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`,
    );
  }
};

/**
 * Real compilation oracle for scaffold output (T2): link runtime deps and
 * typecheck the api AND contracts packages with tsc. Catches non-compiling
 * output (bad mock values, dangling imports, facade/schema drift) that string
 * greps never could.
 */
export const typecheckScaffoldedWorkspace = async (outputDirectory: string): Promise<void> => {
  await linkScaffoldDependencies(outputDirectory);
  await runTsc(path.join(outputDirectory, "apps", "api", "tsconfig.json"));
  await runTsc(path.join(outputDirectory, "packages", "contracts", "tsconfig.json"));
};

export const PLUMB_EXECUTABLE = path.join(
  process.env.HOME ?? "",
  ".meridian",
  "plumb",
  "plumb",
);

export const plumbAvailable = async (): Promise<boolean> => {
  try {
    await fs.access(PLUMB_EXECUTABLE);
    return true;
  } catch {
    return false;
  }
};

/**
 * Doctrine oracle: a fresh scaffold must produce ZERO plumb findings — the
 * permanent coupling between the generator and Meridian doctrine. Any new
 * plumb rule a fresh scaffold violates fails this suite.
 */
export const expectPlumbClean = async (outputDirectory: string): Promise<void> => {
  try {
    await execFileAsync(PLUMB_EXECUTABLE, [outputDirectory]);
  } catch (error: unknown) {
    const failure = error as { stdout?: string; stderr?: string };
    throw new Error(
      `Scaffold output has plumb findings:\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`,
    );
  }
};
