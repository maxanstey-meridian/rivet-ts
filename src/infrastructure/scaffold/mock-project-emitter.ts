import fs from "node:fs/promises";
import path from "node:path";
import { MockProjectEmitter, type MockProjectEmitterConfig } from "../../application/ports/mock-project-emitter.js";
import { emitLocalRivetSource } from "../codegen/local-rivet-emitter.js";
import { toKebabCase } from "../codegen/kebab-case.js";
import { generateEndpointMock } from "./mock-value-generator.js";
import { collectLocalDependencies } from "../typescript/local-source-dependencies.js";

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
  readonly supportsDemoCall: boolean;
};

type PackageManifest = {
  readonly version?: string;
  readonly peerDependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
};

type DemoClientCall = {
  readonly clientNamespace: string;
  readonly methodName: string;
  readonly label: string;
};

const DEFAULT_TYPESCRIPT_VERSION = "^6.0.2";
const DEFAULT_VITE_VERSION = "^6.4.2";
const DEFAULT_RIVET_TS_DEPENDENCY = "github:maxanstey-meridian/rivet-ts#v0.8";
const DEFAULT_RIVET_VERSION = "0.33.0";

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

const toRuntimeModulePath = (relativePath: string): string =>
  relativePath
    .replace(/\.tsx?$/u, ".js")
    .replace(/\.mts$/u, ".mjs")
    .replace(/\.cts$/u, ".cjs");

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
        supportsDemoCall: supportedSources.length === 0 && mock.result.kind === "value",
      });
    }
  }

  return descriptors;
};

const selectDemoClientCall = (
  groups: readonly ContractGroup[],
  handlers: readonly HandlerDescriptor[],
): DemoClientCall | undefined => {
  for (const group of groups) {
    const supportedHandler = handlers.find(
      (handler) => handler.contractName === group.contractName && handler.supportsDemoCall,
    );

    if (!supportedHandler) {
      continue;
    }

    const clientNamespace = toCamelCase(group.controllerName);
    return {
      clientNamespace,
      methodName: supportedHandler.runtimeEndpointName,
      label: `${clientNamespace}.${supportedHandler.runtimeEndpointName}()`,
    };
  }

  return undefined;
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

  return `export type { ${exports} } from "../${toRuntimeModulePath(entryRelativePath)}";\n`;
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

const emitUiMainSource = (demoCall: DemoClientCall | undefined): string => {
  if (!demoCall) {
    return [
      'import { configureLocalRivet } from "@api/src/local-rivet.js";',
      "",
      "configureLocalRivet();",
      "",
      'const output = document.getElementById("output");',
      "",
      "if (output) {",
      '  output.textContent = [',
      '    "Local Rivet transport configured.",',
      '    "Open ui/src/main.ts and start consuming @api/generated/rivet/client.",',
      '  ].join("\\n");',
      "}",
      "",
    ].join("\n");
  }

  return [
    `import { ${demoCall.clientNamespace} } from "@api/generated/rivet/client/index.js";`,
    'import { configureLocalRivet } from "@api/src/local-rivet.js";',
    "",
    "const render = async (): Promise<void> => {",
    "  configureLocalRivet();",
    "",
    '  const output = document.getElementById("output");',
    "  if (!output) {",
    "    return;",
    "  }",
    "",
    `  const result = await ${demoCall.label};`,
    "",
    '  output.textContent = [',
    `    ${JSON.stringify(demoCall.label)},`,
    '    JSON.stringify(result, null, 2),',
    '    "",',
    '    "Open ui/src/main.ts and keep consuming @api/generated/rivet/client.",',
    '  ].join("\\n");',
    "};",
    "",
    "void render();",
    "",
  ].join("\n");
};

const emitUiIndexHtmlSource = (projectName: string): string => `<!DOCTYPE html>
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
  <p>Hono-backed Rivet mock scaffold. Start consuming the generated client in ui/src/main.ts.</p>
  <pre id="output"></pre>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
`;

const emitRootViteConfigSource = (entryRelativePath: string): string => [
  'import { defineConfig } from "vite";',
  'import { rivetTs } from "rivet-ts/vite";',
  "",
  "export default defineConfig({",
  '  root: "./ui",',
  "  plugins: [",
  "    rivetTs({",
  `      contract: "./packages/api/${entryRelativePath}",`,
  '      apiRoot: "./packages/api",',
  '      app: "./packages/api/src/api.ts",',
  "      rivet: {",
  `        version: ${JSON.stringify(DEFAULT_RIVET_VERSION)},`,
  "      },",
  "    }),",
  "  ],",
  "});",
  "",
].join("\n");

const emitApiTsconfigSource = (): string => JSON.stringify(
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
    include: ["./**/*.ts", "./**/*.tsx", "./**/*.mts", "./**/*.cts"],
  },
  null,
  2,
) + "\n";

const emitRootPackageJsonSource = async (projectName: string): Promise<string> => {
  const manifest = await readPackageManifest();
  const honoVersion = manifest.peerDependencies?.hono ?? "^4.0.0";
  const typescriptVersion = manifest.devDependencies?.typescript ?? DEFAULT_TYPESCRIPT_VERSION;

  return JSON.stringify(
    {
      name: toKebabCase(projectName) || "rivet-mock",
      private: true,
      type: "module",
      scripts: {
        dev: "vite",
        build: "vite build",
      },
      dependencies: {
        hono: honoVersion,
        "rivet-ts": DEFAULT_RIVET_TS_DEPENDENCY,
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

const emitApiPackageJsonSource = async (
  contractJsonFileName: string,
  entryRelativePath: string,
): Promise<string> => {
  const manifest = await readPackageManifest();
  const honoVersion = manifest.peerDependencies?.hono ?? "^4.0.0";
  const typescriptVersion = manifest.devDependencies?.typescript ?? DEFAULT_TYPESCRIPT_VERSION;

  return JSON.stringify(
    {
      name: "api",
      private: true,
      type: "module",
      scripts: {
        generate: `pnpm exec rivet-reflect-ts --entry ${entryRelativePath} --out generated/${contractJsonFileName} && rivet --from generated/${contractJsonFileName} --output generated/rivet`,
      },
      dependencies: {
        hono: honoVersion,
        "rivet-ts": DEFAULT_RIVET_TS_DEPENDENCY,
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
    const demoCall = selectDemoClientCall(groups, handlers);
    const apiRoot = path.join(config.outDir, "packages", "api");
    const apiSourceRoot = path.join(apiRoot, "src");
    const uiRoot = path.join(config.outDir, "ui");
    const localRivetPath = path.join(apiSourceRoot, "local-rivet.ts");

    await fs.mkdir(path.join(apiSourceRoot, "handlers"), { recursive: true });
    await fs.mkdir(path.join(apiRoot, "generated"), { recursive: true });
    await fs.mkdir(path.join(uiRoot, "src"), { recursive: true });

    await Promise.all([
      fs.writeFile(path.join(config.outDir, "package.json"), await emitRootPackageJsonSource(config.projectName)),
      fs.writeFile(path.join(config.outDir, "vite.config.ts"), emitRootViteConfigSource(entryDependency.relativePath)),
      fs.writeFile(path.join(uiRoot, "index.html"), emitUiIndexHtmlSource(config.projectName)),
      fs.writeFile(path.join(uiRoot, "src", "main.ts"), emitUiMainSource(demoCall)),
      fs.writeFile(path.join(apiRoot, "package.json"), await emitApiPackageJsonSource(config.contractJsonFileName, entryDependency.relativePath)),
      fs.writeFile(path.join(apiRoot, "tsconfig.json"), emitApiTsconfigSource()),
      fs.writeFile(path.join(apiSourceRoot, "contract.ts"), emitContractSource(groups, entryDependency.relativePath)),
      fs.writeFile(path.join(apiSourceRoot, "api.ts"), emitApiSource(config.contractJsonFileName, groups, handlers)),
      fs.writeFile(
        localRivetPath,
        emitLocalRivetSource({
          filePath: localRivetPath,
          appFilePath: path.join(apiSourceRoot, "api.ts"),
          generatedRivetFilePath: path.join(apiRoot, "generated", "rivet", "rivet.ts"),
        }),
      ),
    ]);

    await Promise.all([
      ...handlers.map((handler) =>
        fs.writeFile(
          path.join(apiSourceRoot, "handlers", `${handler.fileBaseName}.ts`),
          emitHandlerSource(handler),
        )
      ),
      ...sourceDependencies.map(async (dependency) => {
        const targetPath = path.join(apiRoot, dependency.relativePath);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        const content = await fs.readFile(dependency.absolutePath, "utf8");
        await fs.writeFile(targetPath, content);
      }),
    ]);
  }
}
