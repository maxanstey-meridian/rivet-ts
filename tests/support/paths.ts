import path from "node:path";

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");

export const fixturePath = (...segments: readonly string[]): string =>
  path.join(PROJECT_ROOT, "tests", "fixtures", ...segments);

/** Import specifier for the authoring types, straight from source (no build needed). */
export const AUTHORING_TYPES = path.join(PROJECT_ROOT, "src", "domain", "authoring-types.js");
