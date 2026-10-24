import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { PROJECT_ROOT } from "../support/paths.js";

/** Every module a built file loads: static imports, re-exports and `import("…")`. */
const moduleSpecifiers = (filePath: string): readonly string[] => {
  const source = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (!argument || !ts.isStringLiteralLike(argument)) {
        throw new Error(
          `${filePath} imports a module whose name is only known at runtime, so its packages can't be checked: ${node.getText(source)}`,
        );
      }
      specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
};

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
    for (const specifier of moduleSpecifiers(filePath)) {
      if (specifier.startsWith(".")) {
        visit(path.resolve(path.dirname(filePath), specifier));
      } else {
        packages.add(specifier);
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

  // The browser-run mock API registers its routes through ./hono too.
  it("keeps ./hono to Hono itself", () => {
    expect([...runtimePackages("hono.js")]).toEqual(["hono/http-exception"]);
  });

  it("serves the reflection pipeline from ./tooling", () => {
    expect(runtimePackages("tooling.js")).toContain("typescript");
  });
});
