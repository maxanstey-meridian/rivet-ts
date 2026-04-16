import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { MockProjectEmitter, type MockProjectEmitterConfig } from "../../application/ports/mock-project-emitter.js";
import { generateEndpointMock } from "./mock-value-generator.js";

type ContractGroup = {
  readonly contractName: string;
  readonly controllerName: string;
  readonly endpointNames: readonly string[];
};

type HandlerDescriptor = {
  readonly endpointName: string;
  readonly runtimeEndpointName: string;
  readonly controllerName: string;
  readonly contractName: string;
  readonly fileBaseName: string;
  readonly exportName: string;
  readonly pattern: string;
  readonly body: string;
};

type SourceDependency = {
  readonly absolutePath: string;
  readonly relativePath: string;
};

type PackageManifest = {
  readonly version?: string;
  readonly peerDependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
};

const DEFAULT_TYPESCRIPT_VERSION = "^6.0.2";
const DEFAULT_VITE_VERSION = "^6.0.5";

const toKebabCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const toCamelCase = (value: string): string => {
  const kebab = toKebabCase(value);
  const segments = kebab.split("-").filter((segment) => segment.length > 0);

  return segments
    .map((segment, index) =>
      index === 0 ? segment : `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`,
    )
    .join("");
};

const deriveControllerName = (contractName: string): string => {
  const baseName = contractName.endsWith("Contract")
    ? contractName.slice(0, -1 * "Contract".length)
    : contractName;

  if (baseName.length === 0) {
    return baseName;
  }

  return `${baseName[0]?.toLowerCase() ?? ""}${baseName.slice(1)}`;
};

const toRuntimeEndpointName = (value: string): string => {
  if (value.length === 0) {
    return value;
  }

  return `${value[0]?.toLowerCase() ?? ""}${value.slice(1)}`;
};

const indent = (value: string, spaces: number): string => {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
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

const collectLocalDependencies = async (entryPath: string): Promise<readonly SourceDependency[]> => {
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

const readPackageManifest = async (): Promise<PackageManifest> => {
  const manifestPath = new URL("../../../package.json", import.meta.url);
  const manifestText = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(manifestText) as PackageManifest;
};

const buildContractGroups = (config: MockProjectEmitterConfig): readonly ContractGroup[] =>
  config.bundle.contracts.map((contract) => ({
    contractName: contract.name,
    controllerName: deriveControllerName(contract.name),
    endpointNames: contract.endpoints.map((endpoint) => endpoint.name),
  }));

const buildHandlerDescriptors = (
  config: MockProjectEmitterConfig,
  groups: readonly ContractGroup[],
): readonly HandlerDescriptor[] => {
  const endpointByName = new Map(
    config.document.endpoints.map((endpoint) => [
      `${endpoint.controllerName}:${endpoint.name}`,
      endpoint,
    ]),
  );
  const baseCounts = new Map<string, number>();

  for (const group of groups) {
    for (const endpointName of group.endpointNames) {
      const baseName = toKebabCase(endpointName);
      baseCounts.set(baseName, (baseCounts.get(baseName) ?? 0) + 1);
    }
  }

  const descriptors: HandlerDescriptor[] = [];

  for (const group of groups) {
    for (const endpointName of group.endpointNames) {
      const runtimeEndpointName = toRuntimeEndpointName(endpointName);
      const endpoint = endpointByName.get(`${group.controllerName}:${runtimeEndpointName}`);
      if (!endpoint) {
        continue;
      }

      const baseName = toKebabCase(endpointName);
      const needsPrefix = (baseCounts.get(baseName) ?? 0) > 1;
      const fileBaseName = needsPrefix
        ? `${toKebabCase(group.controllerName)}-${baseName}`
        : baseName;
      const exportName = needsPrefix
        ? `${toCamelCase(group.controllerName)}${endpointName[0]?.toUpperCase() ?? ""}${endpointName.slice(1)}`
        : toCamelCase(endpointName);

      const supportedSources = endpoint.params.filter(
        (param) => param.source === "body" || param.source === "route" || param.source === "query",
      );
      const hasBody = supportedSources.some((param) => param.source === "body");
      const hasRoute = supportedSources.some((param) => param.source === "route");
      const hasQuery = supportedSources.some((param) => param.source === "query");
      const patternParts = [hasBody ? "body" : null, hasRoute ? "params" : null, hasQuery ? "query" : null]
        .filter((part): part is string => part !== null);
      const pattern = patternParts.length === 0 ? "" : `{ ${patternParts.join(", ")} }`;

      const mock = generateEndpointMock(endpoint, config.document);
      const unsupportedParams = endpoint.params.filter(
        (param) => param.source !== "body" && param.source !== "route" && param.source !== "query",
      );

      const todoLines: string[] = [];

      for (const diagnostic of mock.diagnostics) {
        todoLines.push(`  // TODO: ${diagnostic.message}`);
      }

      for (const param of unsupportedParams) {
        todoLines.push(
          `  // TODO: Endpoint "${endpoint.name}" uses unsupported param source "${param.source}" in scaffold-mock v1.`,
        );
      }

      let body: string;
      if (mock.result.kind === "todo" || unsupportedParams.length > 0) {
        const message = mock.result.kind === "todo"
          ? mock.result.message
          : `Endpoint "${endpoint.name}" uses unsupported parameter sources in scaffold-mock v1.`;
        body = [
          ...todoLines,
          `  throw new Error(${JSON.stringify(message)});`,
        ].join("\n");
      } else if (mock.result.kind === "void") {
        body = "  return undefined;";
      } else {
        const expression = JSON.stringify(mock.result.value, null, 2);
        body = `  return ${indent(expression, 2).trimStart()};`;
      }

      descriptors.push({
        endpointName,
        runtimeEndpointName,
        controllerName: group.controllerName,
        contractName: group.contractName,
        fileBaseName,
        exportName,
        pattern,
        body,
      });
    }
  }

  return descriptors;
};

const emitHandlerSource = (descriptor: HandlerDescriptor): string => {
  const parameter = descriptor.pattern.length === 0 ? "" : descriptor.pattern;

  return [
    'import type { RivetHandler } from "rivet-ts";',
    `import type { ${descriptor.contractName} } from "../contract.js";`,
    "",
    `export const ${descriptor.exportName}: RivetHandler<${descriptor.contractName}, "${descriptor.endpointName}"> = async (${parameter}) => {`,
    descriptor.body,
    "};",
    "",
  ].join("\n");
};

const emitContractSource = (
  groups: readonly ContractGroup[],
  entryRelativePath: string,
): string => {
  const exports = groups
    .map((group) => group.contractName)
    .sort()
    .join(", ");

  return `export type { ${exports} } from "./contract-source/${entryRelativePath.replace(/\.tsx?$/u, ".js").replace(/\.mts$/u, ".mjs").replace(/\.cts$/u, ".cjs")}";\n`;
};

const emitApiSource = (
  contractJsonFileName: string,
  groups: readonly ContractGroup[],
  handlers: readonly HandlerDescriptor[],
): string => {
  const lines = [
    'import { Hono } from "hono";',
    'import { mount } from "rivet-ts/hono";',
    `import contract from "../generated/${contractJsonFileName}";`,
    `import type { ${groups.map((group) => group.contractName).sort().join(", ")} } from "./contract.js";`,
  ];

  for (const handler of handlers) {
    lines.push(
      `import { ${handler.exportName} } from "./handlers/${handler.fileBaseName}.js";`,
    );
  }

  lines.push("");

  for (const group of groups) {
    const groupHandlers = handlers.filter((handler) => handler.contractName === group.contractName);
    lines.push(
      `const ${toCamelCase(group.controllerName)}App = mount<${group.contractName}>(contract, {`,
    );
    for (const handler of groupHandlers) {
      lines.push(`  ${handler.endpointName}: ${handler.exportName},`);
    }
    lines.push(`}, { controllerName: ${JSON.stringify(group.controllerName)} });`);
    lines.push("");
  }

  lines.push("export const app = new Hono();");
  for (const group of groups) {
    lines.push(`app.route("/", ${toCamelCase(group.controllerName)}App);`);
  }
  lines.push("");

  return lines.join("\n");
};

const emitLocalRivetSource = (): string => [
  'import { app } from "./api.js";',
  'import { configureRivet as configureGeneratedRivet, type RivetConfig } from "../generated/rivet/rivet.js";',
  "",
  'type LocalRivetConfig = Omit<RivetConfig, "fetch" | "baseUrl"> & {',
  "  readonly baseUrl?: string;",
  "};",
  "",
  "export const configureLocalRivet = (config: LocalRivetConfig = {}): void => {",
  "  configureGeneratedRivet({",
  "    ...config,",
  '    baseUrl: config.baseUrl ?? "http://local",',
  "    fetch: (input, init) => Promise.resolve(app.request(input as string, init)),",
  "  });",
  "};",
  "",
].join("\n");

const emitMainSource = (): string => [
  'import { configureLocalRivet } from "./local-rivet.js";',
  "",
  "configureLocalRivet();",
  "",
  'const output = document.getElementById("output");',
  "",
  "if (output) {",
  '  output.textContent = [',
  '    "Local Rivet transport configured.",',
  '    "Run pnpm run generate, then import your generated client from ../generated/rivet/client.",',
  '  ].join("\\n");',
  "}",
  "",
].join("\n");

const emitIndexHtmlSource = (projectName: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${projectName}</title>
  <style>
    body { font-family: monospace; background: #1a1a1a; color: #e0e0e0; padding: 2rem; }
    h1 { color: #fff; font-size: 1.2rem; }
    p { color: #888; margin-bottom: 1rem; }
    pre { background: #111; padding: 1rem; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>${projectName}</h1>
  <p>Hono-backed Rivet mock scaffold. Local transport is configured with configureLocalRivet().</p>
  <pre id="output"></pre>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
`;

const emitViteConfigSource = (): string => [
  'import { defineConfig } from "vite";',
  "",
  "export default defineConfig({",
  '  root: ".",',
  "  server: { port: 3333 },",
  "});",
  "",
].join("\n");

const emitTsconfigSource = (): string => JSON.stringify(
  {
    compilerOptions: {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      lib: ["ESNext", "DOM"],
    },
    include: ["src", "generated"],
  },
  null,
  2,
) + "\n";

const emitPackageJsonSource = async (
  projectName: string,
  contractJsonFileName: string,
  entryRelativePath: string,
): Promise<string> => {
  const manifest = await readPackageManifest();
  const rivetTsVersion = manifest.version ? `^${manifest.version}` : "latest";
  const honoVersion = manifest.peerDependencies?.hono ?? "^4.0.0";
  const typescriptVersion = manifest.devDependencies?.typescript ?? DEFAULT_TYPESCRIPT_VERSION;

  return JSON.stringify(
    {
      name: toKebabCase(projectName) || "rivet-mock",
      private: true,
      type: "module",
      scripts: {
        generate: `pnpm exec rivet-reflect-ts --entry src/contract-source/${entryRelativePath} --out generated/${contractJsonFileName} && rivet --from generated/${contractJsonFileName} --output generated/rivet`,
        dev: "vite",
        build: "vite build",
      },
      dependencies: {
        hono: honoVersion,
        "rivet-ts": rivetTsVersion,
      },
      devDependencies: {
        typescript: typescriptVersion,
        vite: DEFAULT_VITE_VERSION,
      },
    },
    null,
    2,
  ) + "\n";
};

export class FileSystemMockProjectEmitter extends MockProjectEmitter {
  public async emit(config: MockProjectEmitterConfig): Promise<void> {
    const sourceDependencies = await collectLocalDependencies(config.entryPath);
    const entryDependency = sourceDependencies.find(
      (dependency) => path.resolve(dependency.absolutePath) === path.resolve(config.entryPath),
    );

    if (!entryDependency) {
      throw new Error(`Could not locate copied entry path for ${config.entryPath}.`);
    }

    const groups = buildContractGroups(config);
    const handlers = buildHandlerDescriptors(config, groups);
    const contractSourceDir = path.join(config.outDir, "src", "contract-source");

    await fs.mkdir(path.join(config.outDir, "src", "handlers"), { recursive: true });
    await fs.mkdir(contractSourceDir, { recursive: true });
    await fs.mkdir(path.join(config.outDir, "generated"), { recursive: true });

    await Promise.all([
      fs.writeFile(path.join(config.outDir, "src", "contract.ts"), emitContractSource(groups, entryDependency.relativePath)),
      fs.writeFile(path.join(config.outDir, "src", "api.ts"), emitApiSource(config.contractJsonFileName, groups, handlers)),
      fs.writeFile(path.join(config.outDir, "src", "local-rivet.ts"), emitLocalRivetSource()),
      fs.writeFile(path.join(config.outDir, "src", "main.ts"), emitMainSource()),
      fs.writeFile(path.join(config.outDir, "index.html"), emitIndexHtmlSource(config.projectName)),
      fs.writeFile(path.join(config.outDir, "vite.config.ts"), emitViteConfigSource()),
      fs.writeFile(path.join(config.outDir, "tsconfig.json"), emitTsconfigSource()),
      fs.writeFile(
        path.join(config.outDir, "package.json"),
        await emitPackageJsonSource(config.projectName, config.contractJsonFileName, entryDependency.relativePath),
      ),
    ]);

    await Promise.all([
      ...handlers.map((handler) =>
        fs.writeFile(
          path.join(config.outDir, "src", "handlers", `${handler.fileBaseName}.ts`),
          emitHandlerSource(handler),
        )
      ),
      ...sourceDependencies.map(async (dependency) => {
        const targetPath = path.join(contractSourceDir, dependency.relativePath);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        const content = await fs.readFile(dependency.absolutePath, "utf8");
        await fs.writeFile(targetPath, content);
      }),
    ]);
  }
}
