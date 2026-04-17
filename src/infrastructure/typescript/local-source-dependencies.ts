import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

export type SourceDependency = {
  readonly absolutePath: string;
  readonly relativePath: string;
};

const findCommonRoot = (filePaths: readonly string[]): string => {
  const [firstPath, ...rest] = filePaths.map((filePath) => path.resolve(filePath));
  if (!firstPath) {
    throw new Error("Cannot determine common root for an empty file list.");
  }

  let common = path.dirname(firstPath);

  for (const candidate of rest) {
    while (!candidate.startsWith(`${common}${path.sep}`) && candidate !== common) {
      const parent = path.dirname(common);
      if (parent === common) {
        break;
      }
      common = parent;
    }
  }

  return common;
};

const resolveLocalModulePath = async (
  fromFilePath: string,
  specifier: string,
): Promise<string | null> => {
  const candidate = path.resolve(path.dirname(fromFilePath), specifier);
  const extension = path.extname(candidate);

  const candidates = extension.length > 0
    ? [
        candidate,
        candidate.replace(/\.(c|m)?js$/u, ".ts"),
        candidate.replace(/\.(c|m)?js$/u, ".tsx"),
        candidate.replace(/\.(c|m)?js$/u, ".mts"),
        candidate.replace(/\.(c|m)?js$/u, ".cts"),
      ]
    : [
        candidate,
        `${candidate}.ts`,
        `${candidate}.tsx`,
        `${candidate}.mts`,
        `${candidate}.cts`,
        path.join(candidate, "index.ts"),
        path.join(candidate, "index.tsx"),
        path.join(candidate, "index.mts"),
        path.join(candidate, "index.cts"),
      ];

  for (const filePath of candidates) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        return filePath;
      }
    } catch {
      continue;
    }
  }

  return null;
};

export const collectLocalDependencies = async (
  entryPath: string,
): Promise<readonly SourceDependency[]> => {
  const queue = [path.resolve(entryPath)];
  const discovered = new Set<string>();

  while (queue.length > 0) {
    const currentPath = queue.pop();
    if (!currentPath || discovered.has(currentPath)) {
      continue;
    }

    discovered.add(currentPath);
    const sourceText = await fs.readFile(currentPath, "utf8");
    const sourceFile = ts.createSourceFile(
      currentPath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const moduleSpecifiers = new Set<string>();

    for (const statement of sourceFile.statements) {
      if (
        (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
        && statement.moduleSpecifier
        && ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        moduleSpecifiers.add(statement.moduleSpecifier.text);
      }
    }

    for (const specifier of moduleSpecifiers) {
      if (!specifier.startsWith(".")) {
        continue;
      }

      const dependencyPath = await resolveLocalModulePath(currentPath, specifier);
      if (dependencyPath) {
        queue.push(dependencyPath);
      }
    }
  }

  const commonRoot = findCommonRoot([...discovered]);
  return [...discovered]
    .sort()
    .map((absolutePath) => ({
      absolutePath,
      relativePath: path.relative(commonRoot, absolutePath).split(path.sep).join("/"),
    }));
};
