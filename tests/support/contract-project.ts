import fs from "node:fs/promises";
import path from "node:path";
import { tempDir } from "./temp.js";

/**
 * Writes a throwaway ES-module project (`package.json` plus `files`, keyed by
 * path relative to the project root) and returns the path of its `contracts.ts`.
 */
export const writeContractProject = async (
  files: Readonly<Record<string, string>>,
  prefix?: string,
): Promise<string> => {
  const dir = await tempDir(prefix);
  const tree = { "package.json": '{ "type": "module" }\n', ...files };
  for (const [relativePath, content] of Object.entries(tree)) {
    const filePath = path.join(dir, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  }
  return path.join(dir, "contracts.ts");
};
