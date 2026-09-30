import fs from "node:fs/promises";
import path from "node:path";

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");

export const fixturePath = (...segments: readonly string[]): string =>
  path.join(PROJECT_ROOT, "tests", "fixtures", ...segments);

/** Import specifier for the authoring types, straight from source (no build needed). */
export const AUTHORING_TYPES = path.join(PROJECT_ROOT, "src", "domain", "authoring-types.js");

/** The package name consumers install and import. */
export const PACKAGE_NAME = "@maxanstey-meridian/rivet-ts";

/** Links this repo into `nodeModulesDirectory` under its package name, as an installed consumer has it. */
export const linkPackage = async (nodeModulesDirectory: string): Promise<void> => {
  const linkPath = path.join(nodeModulesDirectory, PACKAGE_NAME);
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  await fs.symlink(PROJECT_ROOT, linkPath, "dir");
};
