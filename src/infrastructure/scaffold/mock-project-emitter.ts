import fs from "node:fs/promises";
import path from "node:path";
import {
  MockProjectEmitter,
  type MockProjectEmitterConfig,
} from "../../application/ports/mock-project-emitter.js";
import { toClientNamespace } from "../codegen/client-package-emitter.js";
import { toKebabCase } from "../codegen/kebab-case.js";
import { collectLocalDependencies } from "../typescript/local-source-dependencies.js";
import { generateEndpointMock } from "./mock-value-generator.js";

type ContractGroup = {
  readonly contractName: string;
  readonly contractBaseName: string;
  readonly group: string;
  readonly moduleDirectoryName: string;
  readonly registrationName: string;
  readonly endpointNames: readonly string[];
};

type HandlerDescriptor = {
  readonly endpointName: string;
  readonly runtimeEndpointName: string;
  readonly group: string;
  readonly contractName: string;
  readonly moduleDirectoryName: string;
  readonly fileBaseName: string;
  readonly handlerExportName: string;
  readonly useCaseExportName: string;
  readonly pattern: string;
  readonly body: string;
  readonly supportsDemoCall: boolean;
};

type PackageManifest = {
  readonly dependencies?: Record<string, string>;
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
const DEFAULT_DEPENDENCY_CRUISER_VERSION = "^17.3.10";
const DEFAULT_RIVET_TS_DEPENDENCY = "github:maxanstey-meridian/rivet-ts#v0.9";
const DEFAULT_RIVET_VERSION = "0.34.0";
const DEFAULT_ZOD_VERSION = "^4.1.12";

const toCamelCase = (value: string): string => {
  const kebab = toKebabCase(value);
  const segments = kebab.split("-").filter((segment) => segment.length > 0);

  return segments
    .map((segment, index) =>
      index === 0 ? segment : `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`,
    )
    .join("");
};

const toPascalCase = (value: string): string => {
  const camel = toCamelCase(value);
  return camel.length === 0 ? camel : `${camel[0]?.toUpperCase() ?? ""}${camel.slice(1)}`;
};

const deriveContractBaseName = (contractName: string): string =>
  contractName.endsWith("Contract") ? contractName.slice(0, -1 * "Contract".length) : contractName;

const deriveGroupName = (contractName: string): string => {
  const baseName = deriveContractBaseName(contractName);

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

const toPackageScope = (projectName: string): string =>
  `@${toKebabCase(projectName) || "rivet-mock"}`;

const readPackageManifest = async (): Promise<PackageManifest> => {
  const manifestPath = new URL("../../../package.json", import.meta.url);
  const manifestText = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(manifestText) as PackageManifest;
};

const buildContractGroups = (config: MockProjectEmitterConfig): readonly ContractGroup[] =>
  config.bundle.contracts.map((contract) => {
    const contractBaseName = deriveContractBaseName(contract.name);

    return {
      contractName: contract.name,
      contractBaseName,
      group: deriveGroupName(contract.name),
      moduleDirectoryName: toKebabCase(contractBaseName),
      registrationName: `register${toPascalCase(contractBaseName)}Module`,
      endpointNames: contract.endpoints.map((endpoint) => endpoint.name),
    };
  });

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
  const descriptors: HandlerDescriptor[] = [];

  for (const group of groups) {
    for (const endpointName of group.endpointNames) {
      const runtimeEndpointName = toRuntimeEndpointName(endpointName);
      const endpoint = endpointByName.get(`${group.group}:${runtimeEndpointName}`);
      if (!endpoint) {
        continue;
      }

      const supportedSources = endpoint.params.filter(
        (param) => param.source === "body" || param.source === "route" || param.source === "query",
      );
      const hasBody = supportedSources.some((param) => param.source === "body");
      const hasRoute = supportedSources.some((param) => param.source === "route");
      const hasQuery = supportedSources.some((param) => param.source === "query");
      const patternParts = [
        hasBody ? "body" : null,
        hasRoute ? "params" : null,
        hasQuery ? "query" : null,
      ].filter((part): part is string => part !== null);
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
        const message =
          mock.result.kind === "todo"
            ? mock.result.message
            : `Endpoint "${endpoint.name}" uses unsupported parameter sources in scaffold-mock v1.`;
        body = [...todoLines, `  throw new Error(${JSON.stringify(message)});`].join("\n");
      } else if (mock.result.kind === "void") {
        body = "  return undefined;";
      } else {
        const expression = JSON.stringify(mock.result.value, null, 2);
        body = `  return ${indent(expression, 2).trimStart()};`;
      }

      descriptors.push({
        endpointName,
        runtimeEndpointName,
        group: group.group,
        contractName: group.contractName,
        moduleDirectoryName: group.moduleDirectoryName,
        fileBaseName: toKebabCase(endpointName),
        handlerExportName: `${toCamelCase(endpointName)}Handler`,
        useCaseExportName: `execute${toPascalCase(endpointName)}`,
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

    return {
      clientNamespace: toClientNamespace(group.group),
      methodName: supportedHandler.runtimeEndpointName,
      label: `${toClientNamespace(group.group)}.${supportedHandler.runtimeEndpointName}()`,
    };
  }

  return undefined;
};

const emitUseCaseSource = (descriptor: HandlerDescriptor): string => {
  const inputTypeName = `${descriptor.endpointName}Input`;
  const outputTypeName = `${descriptor.endpointName}Output`;

  return [
    'import type { RivetHandlerInput, RivetHandlerResult } from "rivet-ts";',
    `import type { ${descriptor.contractName} } from "#contract";`,
    "",
    `type ${inputTypeName} = RivetHandlerInput<${descriptor.contractName}, "${descriptor.endpointName}">;`,
    `type ${outputTypeName} = RivetHandlerResult<${descriptor.contractName}, "${descriptor.endpointName}">;`,
    "",
    `export const ${descriptor.useCaseExportName} = async (_input: ${inputTypeName}): Promise<${outputTypeName}> => {`,
    descriptor.body,
    "};",
    "",
  ].join("\n");
};

const emitHandlerSource = (descriptor: HandlerDescriptor): string => {
  const parameter = descriptor.pattern.length === 0 ? "" : "input";
  const invocation =
    descriptor.pattern.length === 0
      ? `${descriptor.useCaseExportName}({})`
      : `${descriptor.useCaseExportName}(input)`;

  return [
    'import type { RivetHandler } from "rivet-ts";',
    `import type { ${descriptor.contractName} } from "#contract";`,
    `import { ${descriptor.useCaseExportName} } from "../../application/${descriptor.fileBaseName}.use-case.js";`,
    "",
    `export const ${descriptor.handlerExportName}: RivetHandler<${descriptor.contractName}, "${descriptor.endpointName}"> = async ${parameter.length === 0 ? "()" : `(${parameter})`} => {`,
    `  return ${invocation};`,
    "};",
    "",
  ].join("\n");
};

const emitModuleSource = (group: ContractGroup): string =>
  [
    `export const ${group.registrationName} = (): void => {`,
    "  // Module composition root goes here.",
    "};",
    "",
  ].join("\n");

const emitCommonModuleSource = (): string =>
  [
    "export const registerCommonModule = (): void => {",
    "  // Module composition root goes here.",
    "};",
    "",
  ].join("\n");

const emitPlaceholderSource = (): string => "export {};\n";

const emitMapContractErrorSource = (): string =>
  [
    'import type { Context } from "hono";',
    "",
    "/* App-level transport error hook. Return null when this error is not handled here; app.ts will rethrow it. */",
    "export const tryMapContractError = (_error: unknown, _context: Context): Response | null => {",
    "  return null;",
    "};",
    "",
  ].join("\n");

const emitContractSource = (groups: readonly ContractGroup[]): string => {
  const exports = groups
    .map((group) => group.contractName)
    .sort()
    .join(", ");

  return `export type { ${exports} } from "./contracts.js";\n`;
};

const emitCompositionSource = (groups: readonly ContractGroup[]): string => {
  const lines = [];

  for (const group of groups) {
    lines.push(
      `import { ${group.registrationName} } from "../modules/${group.moduleDirectoryName}/${group.moduleDirectoryName}.module.js";`,
    );
  }

  lines.push('import { registerCommonModule } from "../modules/common/common.module.js";');

  lines.push("");
  lines.push("export const compose = (): void => {");
  lines.push("  registerCommonModule();");

  for (const group of groups) {
    lines.push(`  ${group.registrationName}();`);
  }

  lines.push("};");
  lines.push("");

  return lines.join("\n");
};

const emitAppSource = (
  groups: readonly ContractGroup[],
  handlers: readonly HandlerDescriptor[],
): string => {
  const lines = [
    'import { Hono } from "hono";',
    'import { registerRivetHonoRoutes } from "rivet-ts/hono";',
    'import contract from "../generated/api.contract.json";',
    'import { compose } from "./app/composition.js";',
    'import { tryMapContractError } from "./app/map-contract-error.js";',
  ];

  for (const group of groups) {
    lines.push(`import type { ${group.contractName} } from "#contract";`);
  }

  for (const handler of handlers) {
    lines.push(
      `import { ${handler.handlerExportName} } from "./modules/${handler.moduleDirectoryName}/interface/http/${handler.fileBaseName}.handler.js";`,
    );
  }

  lines.push("");
  lines.push("compose();");
  lines.push("");
  lines.push("export const app = new Hono();");
  lines.push("");

  for (const group of groups) {
    const moduleHandlers = handlers.filter(
      (handler) => handler.contractName === group.contractName,
    );

    lines.push(`registerRivetHonoRoutes<${group.contractName}>(app, contract, {`);
    lines.push("  handlers: {");
    for (const handler of moduleHandlers) {
      lines.push(`    ${handler.endpointName}: ${handler.handlerExportName},`);
    }
    lines.push("  },");
    lines.push(`  group: ${JSON.stringify(group.group)},`);
    lines.push("});");
    lines.push("");
  }

  lines.push("app.onError((error, context) => {");
  lines.push("  const response = tryMapContractError(error, context);");
  lines.push("  if (response !== null) {");
  lines.push("    return response;");
  lines.push("  }");
  lines.push("");
  lines.push("  throw error;");
  lines.push("});");
  lines.push("");

  return lines.join("\n");
};

const emitLocalSource = (): string => 'export { app } from "../app.js";\n';

const emitUiMainSource = (packageScope: string, demoCall: DemoClientCall | undefined): string => {
  if (!demoCall) {
    return [
      'import { configureLocalRivet } from "../rivet-local";',
      "",
      "configureLocalRivet();",
      "",
      'const output = document.getElementById("output");',
      "",
      "if (output) {",
      "  output.textContent = [",
      '    "Local Rivet transport configured.",',
      `    ${JSON.stringify(`Open ui/src/main.ts and start consuming ${packageScope}/client.`)},`,
      '  ].join("\\n");',
      "}",
      "",
    ].join("\n");
  }

  return [
    `import { ${demoCall.clientNamespace} } from "${packageScope}/client";`,
    'import { configureLocalRivet } from "../rivet-local";',
    "",
    "const render = async () => {",
    "  configureLocalRivet();",
    "",
    '  const output = document.getElementById("output");',
    "  if (!output) {",
    "    return;",
    "  }",
    "",
    `  const result = await ${demoCall.label};`,
    "",
    "  output.textContent = [",
    `    ${JSON.stringify(demoCall.label)},`,
    "    JSON.stringify(result, null, 2),",
    '    "",',
    `    ${JSON.stringify(`Open ui/src/main.ts and keep consuming ${packageScope}/client.`)},`,
    '  ].join("\\n");',
    "};",
    "",
    "void render();",
    "",
  ].join("\n");
};

const emitUiLocalRivetSource = (packageScope: string): string =>
  [
    `import { configureRivet, type RivetConfig } from "${packageScope}/client";`,
    `import { app } from "${packageScope}/api/local";`,
    'import { configureLocalRivet as configureRivetLocalRuntime } from "rivet-ts/local";',
    "",
    'type LocalRivetConfig = Omit<RivetConfig, "fetch" | "baseUrl"> & {',
    "  readonly baseUrl?: string;",
    "};",
    "",
    '/* Replace this with configureRivet({ baseUrl: "https://api.example.com" }) when you are ready to promote the API to a real server. */',
    "export const configureLocalRivet = (config: LocalRivetConfig = {}) => {",
    "  configureRivetLocalRuntime({",
    "    ...config,",
    "    configureRivet,",
    "    dispatch: (input, init) => app.request(input as string, init),",
    "  });",
    "};",
    "",
  ].join("\n");

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
  <p>Hono-backed Rivet mock scaffold. Local transport is wired in ui/rivet-local.ts.</p>
  <pre id="output"></pre>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
`;

const emitRootViteConfigSource = (): string =>
  [
    'import { defineConfig } from "vite";',
    'import { rivetTs } from "rivet-ts/vite";',
    "",
    "export default defineConfig({",
    '  root: "./ui",',
    "  plugins: [",
    "    rivetTs({",
    '      entry: "./packages/api/src/app/contracts.ts",',
    '      apiRoot: "./packages/api",',
    '      runtimeContractOut: "./packages/api/generated/api.contract.json",',
    '      clientOutDir: "./packages/client/generated",',
    "      rivet: {",
    `        version: ${JSON.stringify(DEFAULT_RIVET_VERSION)},`,
    "      },",
    "    }),",
    "  ],",
    "});",
    "",
  ].join("\n");

const emitPnpmWorkspaceSource = (): string => ["packages:", '  - "packages/*"', ""].join("\n");

const emitRootTsconfigSource = (packageScope: string): string =>
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2022", "DOM"],
        strict: true,
        noEmit: true,
        verbatimModuleSyntax: true,
        isolatedModules: true,
        esModuleInterop: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        ignoreDeprecations: "6.0",
        types: ["node"],
        baseUrl: ".",
        paths: {
          [`${packageScope}/client`]: ["./packages/client/generated/index.ts"],
          [`${packageScope}/api/local`]: ["./packages/api/src/app/local.ts"],
        },
      },
      include: ["ui/**/*.ts", "vite.config.ts"],
    },
    null,
    2,
  ) + "\n";

const emitDependencyCruiserConfigSource = (): string =>
  [
    "module.exports = {",
    "  forbidden: [",
    "    {",
    '      name: "no-circular",',
    '      severity: "error",',
    '      comment: "Circular dependencies make ownership and dependency direction unclear.",',
    "      from: {},",
    "      to: {",
    "        circular: true,",
    "      },",
    "    },",
    "    {",
    '      name: "no-feature-to-feature",',
    '      severity: "error",',
    '      comment: "Feature modules may depend only on themselves and common.",',
    "      from: {",
    '        path: "^packages/api/src/modules/(?!common/)([^/]+)/.+\\\\.ts$",',
    "      },",
    "      to: {",
    '        path: "^packages/api/src/modules/.+\\\\.ts$",',
    '        pathNot: "^packages/api/src/modules/($1|common)/",',
    "      },",
    "    },",
    "    {",
    '      name: "no-common-to-feature",',
    '      severity: "error",',
    '      comment: "Common is shared infrastructure, not a backdoor into feature internals.",',
    "      from: {",
    '        path: "^packages/api/src/modules/common/.+\\\\.ts$",',
    "      },",
    "      to: {",
    '        path: "^packages/api/src/modules/(?!common/).+\\\\.ts$",',
    "      },",
    "    },",
    "    {",
    '      name: "no-domain-outside-own-domain",',
    '      severity: "error",',
    '      comment: "Domain stays inside its own local domain boundary.",',
    "      from: {",
    '        path: "^packages/api/src/modules/(?!common/)([^/]+)/domain/.+\\\\.ts$",',
    "      },",
    "      to: {",
    '        path: "^packages/api/src/.+\\\\.ts$",',
    '        pathNot: "^packages/api/src/modules/$1/domain/",',
    "      },",
    "    },",
    "    {",
    '      name: "no-application-to-infrastructure",',
    '      severity: "error",',
    '      comment: "Application must not depend on infrastructure.",',
    "      from: {",
    '        path: "^packages/api/src/modules/[^/]+/application/.+\\\\.ts$",',
    "      },",
    "      to: {",
    '        path: "^packages/api/src/modules/[^/]+/infrastructure/.+\\\\.ts$",',
    "      },",
    "    },",
    "    {",
    '      name: "no-application-to-interface",',
    '      severity: "error",',
    '      comment: "Application must not depend on transport.",',
    "      from: {",
    '        path: "^packages/api/src/modules/[^/]+/application/.+\\\\.ts$",',
    "      },",
    "      to: {",
    '        path: "^packages/api/src/modules/[^/]+/interface/.+\\\\.ts$",',
    "      },",
    "    },",
    "    {",
    '      name: "no-infrastructure-to-interface",',
    '      severity: "error",',
    '      comment: "Infrastructure must not depend on transport.",',
    "      from: {",
    '        path: "^packages/api/src/modules/[^/]+/infrastructure/.+\\\\.ts$",',
    "      },",
    "      to: {",
    '        path: "^packages/api/src/modules/[^/]+/interface/.+\\\\.ts$",',
    "      },",
    "    },",
    "    {",
    '      name: "no-handler-to-domain",',
    '      severity: "error",',
    '      comment: "HTTP handlers should go through application, not domain.",',
    "      from: {",
    '        path: "^packages/api/src/modules/[^/]+/interface/http/.+\\\\.handler\\\\.ts$",',
    "      },",
    "      to: {",
    '        path: "^packages/api/src/modules/[^/]+/domain/.+\\\\.ts$",',
    "      },",
    "    },",
    "    {",
    '      name: "no-handler-to-infrastructure",',
    '      severity: "error",',
    '      comment: "HTTP handlers must not depend on infrastructure directly.",',
    "      from: {",
    '        path: "^packages/api/src/modules/[^/]+/interface/http/.+\\\\.handler\\\\.ts$",',
    "      },",
    "      to: {",
    '        path: "^packages/api/src/modules/[^/]+/infrastructure/.+\\\\.ts$",',
    "      },",
    "    },",
    "    {",
    '      name: "no-module-to-app-runtime",',
    '      severity: "error",',
    '      comment: "Composition happens at the app edge, not inside modules.",',
    "      from: {",
    '        path: "^packages/api/src/modules/.+\\\\.ts$",',
    "      },",
    "      to: {",
    '        path: "^packages/api/src/(app\\\\.ts|app/.+\\\\.ts)$",',
    '        pathNot: "^packages/api/src/app/contract\\\\.ts$",',
    "      },",
    "    },",
    "    {",
    '      name: "no-api-to-client",',
    '      severity: "error",',
    '      comment: "API source must not depend on client artifacts.",',
    "      from: {",
    '        path: "^packages/api/src/.+\\\\.ts$",',
    "      },",
    "      to: {",
    '        path: "^packages/client/.+\\\\.(ts|js|json)$",',
    "      },",
    "    },",
    "  ],",
    "  options: {",
    "    doNotFollow: {",
    '      path: "^node_modules",',
    "    },",
    "    tsPreCompilationDeps: true,",
    "    tsConfig: {",
    '      fileName: "tsconfig.json",',
    "    },",
    "  },",
    "};",
    "",
  ].join("\n");

const emitApiTsconfigSource = (): string =>
  JSON.stringify(
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
      include: ["./src/**/*.ts"],
    },
    null,
    2,
  ) + "\n";

const emitClientTsconfigSource = (): string =>
  JSON.stringify(
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
      include: ["./generated/**/*.ts"],
    },
    null,
    2,
  ) + "\n";

const emitRootPackageJsonSource = async (
  projectName: string,
  packageScope: string,
): Promise<string> => {
  const manifest = await readPackageManifest();
  const nodeTypesVersion = manifest.devDependencies?.["@types/node"] ?? "^25.5.2";
  const typescriptVersion = manifest.devDependencies?.typescript ?? DEFAULT_TYPESCRIPT_VERSION;
  const dependencyCruiserVersion =
    manifest.devDependencies?.["dependency-cruiser"] ?? DEFAULT_DEPENDENCY_CRUISER_VERSION;

  return (
    JSON.stringify(
      {
        name: toKebabCase(projectName) || "rivet-mock",
        private: true,
        type: "module",
        scripts: {
          generate: "pnpm --dir packages/api run generate",
          dev: "vite",
          build: "vite build",
          check: "tsc --noEmit",
          "check:architecture":
            "depcruise --config .dependency-cruiser.cjs --ts-config tsconfig.json packages/api/src",
          test: "pnpm run check && pnpm run check:architecture",
        },
        dependencies: {
          [`${packageScope}/api`]: "workspace:*",
          [`${packageScope}/client`]: "workspace:*",
          "rivet-ts": DEFAULT_RIVET_TS_DEPENDENCY,
        },
        devDependencies: {
          "@types/node": nodeTypesVersion,
          "dependency-cruiser": dependencyCruiserVersion,
          typescript: typescriptVersion,
          vite: DEFAULT_VITE_VERSION,
        },
      },
      null,
      2,
    ) + "\n"
  );
};

const emitApiPackageJsonSource = async (packageScope: string): Promise<string> => {
  const manifest = await readPackageManifest();
  const honoVersion = manifest.peerDependencies?.hono ?? "^4.0.0";

  return (
    JSON.stringify(
      {
        name: `${packageScope}/api`,
        private: true,
        type: "module",
        imports: {
          "#contract": "./src/app/contract.ts",
        },
        exports: {
          "./local": "./src/app/local.ts",
        },
        scripts: {
          generate:
            "pnpm exec rivet-reflect-ts --entry src/app/contracts.ts --out generated/api.contract.json && rivet --from generated/api.contract.json --output ../client/generated/rivet && pnpm exec rivet-ts generate --generated-root ../client/generated",
        },
        dependencies: {
          hono: honoVersion,
          "rivet-ts": DEFAULT_RIVET_TS_DEPENDENCY,
        },
      },
      null,
      2,
    ) + "\n"
  );
};

const emitClientPackageJsonSource = async (packageScope: string): Promise<string> => {
  const manifest = await readPackageManifest();
  const zodVersion = manifest.dependencies?.zod ?? DEFAULT_ZOD_VERSION;

  return (
    JSON.stringify(
      {
        name: `${packageScope}/client`,
        private: true,
        type: "module",
        exports: {
          ".": "./generated/index.ts",
        },
        dependencies: {
          "rivet-ts": DEFAULT_RIVET_TS_DEPENDENCY,
          zod: zodVersion,
        },
      },
      null,
      2,
    ) + "\n"
  );
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
    const packageScope = toPackageScope(config.projectName);
    const apiRoot = path.join(config.outDir, "packages", "api");
    const apiSourceRoot = path.join(apiRoot, "src");
    const apiAppRoot = path.join(apiSourceRoot, "app");
    const apiInterfaceRoot = path.join(apiSourceRoot, "interface", "http");
    const apiGeneratedRoot = path.join(apiRoot, "generated");
    const clientRoot = path.join(config.outDir, "packages", "client");
    const clientGeneratedRoot = path.join(clientRoot, "generated");
    const uiRoot = path.join(config.outDir, "ui");

    await fs.mkdir(apiAppRoot, { recursive: true });
    await fs.mkdir(apiInterfaceRoot, { recursive: true });
    await fs.mkdir(apiGeneratedRoot, { recursive: true });
    await fs.mkdir(clientGeneratedRoot, { recursive: true });
    await fs.mkdir(path.join(uiRoot, "src"), { recursive: true });

    for (const group of groups) {
      const moduleRoot = path.join(apiSourceRoot, "modules", group.moduleDirectoryName);
      await fs.mkdir(path.join(moduleRoot, "application"), { recursive: true });
      await fs.mkdir(path.join(moduleRoot, "domain"), { recursive: true });
      await fs.mkdir(path.join(moduleRoot, "infrastructure"), { recursive: true });
      await fs.mkdir(path.join(moduleRoot, "interface", "http"), { recursive: true });
    }

    await fs.mkdir(path.join(apiSourceRoot, "modules", "common", "application"), {
      recursive: true,
    });
    await fs.mkdir(path.join(apiSourceRoot, "modules", "common", "infrastructure"), {
      recursive: true,
    });

    await Promise.all([
      fs.writeFile(
        path.join(config.outDir, "package.json"),
        await emitRootPackageJsonSource(config.projectName, packageScope),
      ),
      fs.writeFile(path.join(config.outDir, "pnpm-workspace.yaml"), emitPnpmWorkspaceSource()),
      fs.writeFile(path.join(config.outDir, "tsconfig.json"), emitRootTsconfigSource(packageScope)),
      fs.writeFile(
        path.join(config.outDir, ".dependency-cruiser.cjs"),
        emitDependencyCruiserConfigSource(),
      ),
      fs.writeFile(path.join(config.outDir, "vite.config.ts"), emitRootViteConfigSource()),
      fs.writeFile(path.join(uiRoot, "index.html"), emitUiIndexHtmlSource(config.projectName)),
      fs.writeFile(path.join(uiRoot, "src", "main.ts"), emitUiMainSource(packageScope, demoCall)),
      fs.writeFile(path.join(uiRoot, "rivet-local.ts"), emitUiLocalRivetSource(packageScope)),
      fs.writeFile(
        path.join(apiRoot, "package.json"),
        await emitApiPackageJsonSource(packageScope),
      ),
      fs.writeFile(path.join(apiRoot, "tsconfig.json"), emitApiTsconfigSource()),
      fs.writeFile(path.join(apiAppRoot, "contract.ts"), emitContractSource(groups)),
      fs.writeFile(path.join(apiAppRoot, "composition.ts"), emitCompositionSource(groups)),
      fs.writeFile(path.join(apiSourceRoot, "app.ts"), emitAppSource(groups, handlers)),
      fs.writeFile(path.join(apiAppRoot, "local.ts"), emitLocalSource()),
      fs.writeFile(path.join(apiAppRoot, "map-contract-error.ts"), emitMapContractErrorSource()),
      fs.writeFile(
        path.join(clientRoot, "package.json"),
        await emitClientPackageJsonSource(packageScope),
      ),
      fs.writeFile(path.join(clientRoot, "tsconfig.json"), emitClientTsconfigSource()),
      fs.writeFile(
        path.join(apiSourceRoot, "modules", "common", "common.module.ts"),
        emitCommonModuleSource(),
      ),
      fs.writeFile(
        path.join(apiSourceRoot, "modules", "common", "application", "index.ts"),
        emitPlaceholderSource(),
      ),
      fs.writeFile(
        path.join(apiSourceRoot, "modules", "common", "infrastructure", "index.ts"),
        emitPlaceholderSource(),
      ),
    ]);

    await Promise.all([
      ...groups.map((group) => {
        const moduleRoot = path.join(apiSourceRoot, "modules", group.moduleDirectoryName);
        const moduleHandlers = handlers.filter(
          (handler) => handler.contractName === group.contractName,
        );

        return Promise.all([
          fs.writeFile(
            path.join(moduleRoot, `${group.moduleDirectoryName}.module.ts`),
            emitModuleSource(group),
          ),
          fs.writeFile(path.join(moduleRoot, "domain", "index.ts"), emitPlaceholderSource()),
          fs.writeFile(
            path.join(moduleRoot, "infrastructure", "index.ts"),
            emitPlaceholderSource(),
          ),
          ...moduleHandlers.map((handler) =>
            fs.writeFile(
              path.join(moduleRoot, "application", `${handler.fileBaseName}.use-case.ts`),
              emitUseCaseSource(handler),
            ),
          ),
          ...moduleHandlers.map((handler) =>
            fs.writeFile(
              path.join(moduleRoot, "interface", "http", `${handler.fileBaseName}.handler.ts`),
              emitHandlerSource(handler),
            ),
          ),
        ]);
      }),
      ...sourceDependencies.map(async (dependency) => {
        const targetPath = path.join(apiAppRoot, dependency.relativePath);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        const content = await fs.readFile(dependency.absolutePath, "utf8");
        await fs.writeFile(targetPath, content);
      }),
    ]);
  }
}
