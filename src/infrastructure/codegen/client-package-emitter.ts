import fs from "node:fs/promises";
import path from "node:path";
import { toKebabCase } from "./kebab-case.js";

const toCamelCase = (value: string): string => {
  const kebab = toKebabCase(value);
  const segments = kebab.split("-").filter((segment) => segment.length > 0);

  return segments
    .map((segment, index) =>
      index === 0 ? segment : `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`,
    )
    .join("");
};

export const toClientNamespace = (moduleFileBaseName: string): string =>
  toCamelCase(moduleFileBaseName);

export type ClientPackageArtifacts = {
  readonly moduleFileBaseNames: readonly string[];
  readonly includeCommonTypes: boolean;
  readonly includeSchemas: boolean;
  readonly includeValidators: boolean;
};

export const emitClientPackageSource = (config: {
  readonly moduleFileBaseNames: readonly string[];
  readonly includeCommonTypes: boolean;
  readonly includeSchemas: boolean;
  readonly includeValidators: boolean;
}): string => {
  const moduleFileBaseNames = [...config.moduleFileBaseNames].sort((left, right) =>
    left.localeCompare(right),
  );
  const lines: string[] = [];

  for (const moduleFileBaseName of moduleFileBaseNames) {
    const namespace = toClientNamespace(moduleFileBaseName);
    lines.push(
      `import * as ${namespace} from ${JSON.stringify(`./rivet/client/${moduleFileBaseName}.js`)};`,
    );
  }

  if (lines.length > 0) {
    lines.push("");
    lines.push(
      `export { ${moduleFileBaseNames.map((moduleFileBaseName) => toClientNamespace(moduleFileBaseName)).join(", ")} };`,
    );
  }

  lines.push('export { RivetError, configureRivet, rivetFetch } from "./rivet/rivet.js";');
  lines.push(
    'export type { RivetConfig, RivetResult, RivetResultMethods, RivetResultOf } from "./rivet/rivet.js";',
  );

  if (config.includeSchemas) {
    lines.push('export * as schemas from "./rivet/schemas.js";');
  }

  if (config.includeValidators) {
    lines.push('export * as validators from "./rivet/validators.js";');
  }

  if (config.includeCommonTypes) {
    lines.push('export type * from "./rivet/types/common.js";');
  }

  for (const moduleFileBaseName of moduleFileBaseNames) {
    lines.push(`export type * from ${JSON.stringify(`./rivet/client/${moduleFileBaseName}.js`)};`);
  }

  lines.push("");

  return lines.join("\n");
};

export const collectClientPackageArtifacts = async (
  generatedRoot: string,
): Promise<ClientPackageArtifacts> => {
  const generatedRivetClientDir = path.join(generatedRoot, "rivet", "client");

  const moduleFileBaseNames = await fs
    .readdir(generatedRivetClientDir, { withFileTypes: true })
    .then((entries) =>
      entries
        .filter(
          (entry) => entry.isFile() && entry.name.endsWith(".ts") && entry.name !== "index.ts",
        )
        .map((entry) => entry.name.slice(0, -1 * ".ts".length))
        .sort((left, right) => left.localeCompare(right)),
    )
    .catch(() => []);

  const includeCommonTypes = await fs
    .stat(path.join(generatedRoot, "rivet", "types", "common.ts"))
    .then(() => true)
    .catch(() => false);
  const includeSchemas = await fs
    .stat(path.join(generatedRoot, "rivet", "schemas.ts"))
    .then(() => true)
    .catch(() => false);
  const includeValidators = await fs
    .stat(path.join(generatedRoot, "rivet", "validators.ts"))
    .then(() => true)
    .catch(() => false);

  return {
    moduleFileBaseNames,
    includeCommonTypes,
    includeSchemas,
    includeValidators,
  };
};

export const emitClientPackage = async (generatedRoot: string): Promise<void> => {
  const outputPath = path.join(generatedRoot, "index.ts");
  const source = `${emitClientPackageSource(await collectClientPackageArtifacts(generatedRoot))}\n`;

  try {
    const current = await fs.readFile(outputPath, "utf8");
    if (current === source) {
      return;
    }
  } catch {
    // noop
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, source, "utf8");
};
