import { execFile } from "node:child_process";
import { accessSync, constants, existsSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PROJECT_ROOT } from "./paths.js";

const execFileAsync = promisify(execFile);

/**
 * Makes a scaffolded workspace resolvable offline: every top-level entry of
 * this repo's node_modules is linked into the scaffold's node_modules, plus
 * rivet-ts itself → this repo (so the emitted code typechecks against the
 * CURRENT runtime, not the pinned GitHub tag).
 */
export const linkScaffoldDependencies = async (outputDirectory: string): Promise<void> => {
  const projectRoot = PROJECT_ROOT;
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

  await fs.symlink(projectRoot, path.join(targetModules, "rivet-ts"), "dir").catch(() => undefined);
};

const runTsc = async (tsconfigPath: string): Promise<void> => {
  const tscPath = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsc");

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
 * Real compilation oracle for scaffold output: link runtime deps and
 * typecheck the api AND contracts packages with tsc. Catches non-compiling
 * output (bad mock values, dangling imports, facade/schema drift) that string
 * greps never could.
 */
export const typecheckScaffoldedWorkspace = async (outputDirectory: string): Promise<void> => {
  await linkScaffoldDependencies(outputDirectory);
  await runTsc(path.join(outputDirectory, "apps", "api", "tsconfig.json"));
  await runTsc(path.join(outputDirectory, "packages", "contracts", "tsconfig.json"));
};

/** `name` on `PATH`, resolved through symlinks; a shell alias is not on `PATH`. */
const findOnPath = (name: string): string | undefined => {
  const { PATH = "" } = process.env;
  const onPath = PATH.split(path.delimiter)
    .map((directory) => path.join(directory, name))
    .find((candidate) => {
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  return onPath === undefined ? undefined : realpathSync(onPath);
};

/** Plumb, from `PLUMB` (which must then exist) or else `plumb` on `PATH`. */
const resolvePlumb = (): string | undefined => {
  const { PLUMB } = process.env;
  if (PLUMB) {
    if (!existsSync(PLUMB)) {
      throw new Error(`PLUMB is set to ${PLUMB}, which does not exist.`);
    }
    return realpathSync(PLUMB);
  }
  return findOnPath("plumb");
};

export const PLUMB_EXECUTABLE = resolvePlumb();

export const PLUMB_NOT_FOUND = "plumb not found: set PLUMB=<path to plumb> or put plumb on PATH";

/** go-task, which runs the scaffolded `Taskfile.yml`. */
export const TASK_EXECUTABLE = findOnPath("task");

export const TASK_NOT_FOUND = "task (go-task) not found on PATH";

/** Runs a scaffolded Taskfile task with `env` added to the environment. */
export const runTask = (
  task: string,
  outputDirectory: string,
  name: string,
  env: Readonly<Record<string, string>>,
): Promise<{ readonly stdout: string; readonly stderr: string }> =>
  execFileAsync(task, [name], { cwd: outputDirectory, env: { ...process.env, ...env } });

export type PlumbFinding = {
  readonly rule: string;
  readonly severity: string;
  readonly location: string;
};

// Findings on fresh scaffolds that are kept deliberately, each with its reason
// in the slop-cleanup ledger (D5, post-0.14 follow-ups). A new finding fails
// the gate, and so does fixing one of these without removing it here.
export const RECORDED_UI_PLUMB_FINDINGS: readonly PlumbFinding[] = [
  // No `nuxt typecheck` script: the scaffold suites cannot run one (nuxt is not
  // among the offline-linked dependencies), so the scaffold does not emit it untested.
  { rule: "MER-TO-004", severity: "warn", location: "apps/ui/package.json:1" },
];

/** Every plumb finding (errors, warnings and info) for a scaffold output directory. */
export const plumbFindings = async (
  plumb: string,
  outputDirectory: string,
): Promise<readonly PlumbFinding[]> => {
  // plumb exits non-zero when a finding is an error; the JSON is on stdout either way.
  const stdout = await execFileAsync(plumb, [outputDirectory, "--json"]).then(
    (result) => result.stdout,
    (error: { stdout?: string }) => error.stdout ?? "",
  );
  const findings = JSON.parse(stdout) as readonly PlumbFinding[];
  return findings.map(({ rule, severity, location }) => ({ rule, severity, location }));
};
