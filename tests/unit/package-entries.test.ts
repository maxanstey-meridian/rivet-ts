import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { PROJECT_ROOT } from "../support/paths.js";

/**
 * The bare specifiers a built entry loads at runtime, following its relative
 * imports. Type-only imports are already erased from `dist/`.
 */
const runtimePackages = (entry: string): ReadonlySet<string> => {
  const packages = new Set<string>();
  const visited = new Set<string>();
  const visit = (filePath: string): void => {
    if (visited.has(filePath)) {
      return;
    }
    visited.add(filePath);
    const { importedFiles } = ts.preProcessFile(fs.readFileSync(filePath, "utf8"), true, false);
    for (const { fileName } of importedFiles) {
      if (fileName.startsWith(".")) {
        visit(path.resolve(path.dirname(filePath), fileName));
      } else {
        packages.add(fileName);
      }
    }
  };
  visit(path.join(PROJECT_ROOT, "dist", entry));
  return packages;
};

describe("package entries", () => {
  // Contracts, handlers and mocks import the root at runtime, and a
  // scaffold-mock runs its API in the browser.
  it("keeps the root entry free of the compiler, the CLI and Node built-ins", () => {
    expect([...runtimePackages("index.js")]).toEqual([]);
  });

  it("serves the reflection pipeline from ./tooling", () => {
    expect(runtimePackages("tooling.js")).toContain("typescript");
  });
});
