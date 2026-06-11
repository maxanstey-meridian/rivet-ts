import fs from "node:fs/promises";
import path from "node:path";
import {
  MockProjectEmitter,
  type MockProjectEmitterConfig,
} from "../../application/ports/mock-project-emitter.js";
import { toKebabCase } from "../codegen/kebab-case.js";
import { collectLocalDependencies } from "../typescript/local-source-dependencies.js";
import { generateEndpointMock } from "./mock-value-generator.js";
import {
  checkOutDirSafety,
  emitWorkspaceSkeleton,
  toPackageScope,
  type WorkspaceConfig,
} from "./workspace-emitter.js";

/**
 * Contract-driven scaffold (`scaffold-mock`): lowers the user's contract entry
 * and emits a golden-shape workspace whose api modules return synthesized mock
 * values. File naming is suffix-free (Meridian §9.1): use cases live at
 * `modules/<m>/application/<endpoint>.ts`, route registration at
 * `src/interface/http/<m>-routes.ts`.
 */

type ContractGroup = {
  readonly contractName: string;
  readonly contractBaseName: string;
  readonly group: string;
  readonly moduleDirectoryName: string;
  readonly endpointNames: readonly string[];
};

type HandlerDescriptor = {
  readonly endpointName: string;
  readonly runtimeEndpointName: string;
  readonly httpMethod: string;
  readonly routeTemplate: string;
  readonly group: string;
  readonly contractName: string;
  readonly moduleDirectoryName: string;
  readonly fileBaseName: string;
  readonly useCaseExportName: string;
  readonly pattern: string;
  readonly body: string;
  readonly supportsDemoCall: boolean;
};

type PackageManifest = {
  readonly version?: string;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
};

const RIVET_TS_DEPENDENCY_REPOSITORY = "github:maxanstey-meridian/rivet-ts";

export const toCamelCase = (value: string): string => {
  const kebab = toKebabCase(value);
  const segments = kebab.split("-").filter((segment) => segment.length > 0);

  return segments
    .map((segment, index) =>
      index === 0 ? segment : `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`,
    )
    .join("");
};

export const toPascalCase = (value: string): string => {
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

export const readPackageManifest = async (): Promise<PackageManifest> => {
  const manifestPath = new URL("../../../package.json", import.meta.url);
  const manifestText = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(manifestText) as PackageManifest;
};

export const toRivetTsDependency = (manifest: PackageManifest): string => {
  if (!manifest.version) {
    throw new Error("rivet-ts package.json is missing a version; cannot pin scaffold dependency.");
  }

  return `${RIVET_TS_DEPENDENCY_REPOSITORY}#v${manifest.version}`;
};

export const resolveWorkspaceVersions = (
  manifest: PackageManifest,
): WorkspaceConfig["versions"] => ({
  hono: manifest.peerDependencies?.hono ?? "^4.0.0",
  openApiFetch: manifest.dependencies?.["openapi-fetch"] ?? "^0.17.0",
  openApiTypescript: manifest.dependencies?.["openapi-typescript"] ?? "^7.13.0",
  typescript: manifest.devDependencies?.typescript ?? "^6.0.2",
  nodeTypes: manifest.devDependencies?.["@types/node"] ?? "^25.5.2",
  vitest: manifest.devDependencies?.vitest ?? "^4.1.2",
});

const buildContractGroups = (config: MockProjectEmitterConfig): readonly ContractGroup[] =>
  config.contracts.map((contract) => {
    const contractBaseName = deriveContractBaseName(contract.name);

    return {
      contractName: contract.name,
      contractBaseName,
      group: deriveGroupName(contract.name),
      moduleDirectoryName: toKebabCase(contractBaseName),
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

  const specByName = new Map(
    config.contracts.flatMap((contract) =>
      contract.endpoints.map(
        (endpoint) => [`${contract.name}:${endpoint.name}`, endpoint] as const,
      ),
    ),
  );

  for (const group of groups) {
    for (const endpointName of group.endpointNames) {
      const runtimeEndpointName = toRuntimeEndpointName(endpointName);
      const endpoint = endpointByName.get(`${group.group}:${runtimeEndpointName}`);
      if (!endpoint) {
        continue;
      }

      const spec = specByName.get(`${group.contractName}:${endpointName}`);
      const supportedSources = endpoint.params.filter(
        (param) => param.source === "body" || param.source === "route" || param.source === "query",
      );
      // The emitted handler signature must mirror the type-level
      // RivetHandlerInput bag, which is derived from the authored spec's
      // input/params/query keys — NOT from the lowered document params.
      // Route-template params lower to source "route" but are absent from the
      // handler's input type, so keying off the document made handlers with
      // route params fail to compile.
      const isBodyMethod = /^(PATCH|POST|PUT)$/iu.test(spec?.method ?? "");
      const patternParts = [
        // H1: `input` is a body only on body-carrying methods; on GET/DELETE
        // the adapter (and the handler types) deliver it under `query`.
        spec?.hasInput ? (isBodyMethod ? "body" : "query") : null,
        spec?.hasParams ? "params" : null,
        spec?.hasQuery && !(spec?.hasInput && !isBodyMethod) ? "query" : null,
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
          `  // TODO: Endpoint "${endpoint.name}" uses unsupported param source "${param.source}" in scaffold-mock.`,
        );
      }

      const outputTypeName = `${endpointName}Output`;
      let body: string;
      if (mock.result.kind === "todo" || unsupportedParams.length > 0) {
        const message =
          mock.result.kind === "todo"
            ? mock.result.message
            : `Endpoint "${endpoint.name}" uses unsupported parameter sources in scaffold-mock.`;
        body = [...todoLines, `  throw new Error(${JSON.stringify(message)});`].join("\n");
      } else if (mock.result.kind === "void") {
        body = "  return undefined;";
      } else {
        const expression = JSON.stringify(mock.result.value, null, 2);
        // Enum members, brands, and example-backed values are not assignable
        // as raw JSON literals; the cast keeps the mock honest about being a
        // mock while letting a fresh scaffold pass its own typecheck.
        const cast = mock.result.needsCast ? ` as ${outputTypeName}` : "";
        body = `  return ${indent(expression, 2).trimStart()}${cast};`;
      }

      descriptors.push({
        endpointName,
        runtimeEndpointName,
        httpMethod: endpoint.httpMethod.toUpperCase(),
        routeTemplate: endpoint.routeTemplate,
        group: group.group,
        contractName: group.contractName,
        moduleDirectoryName: group.moduleDirectoryName,
        fileBaseName: toKebabCase(endpointName),
        useCaseExportName: toCamelCase(endpointName),
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
): WorkspaceConfig["demoCall"] => {
  for (const group of groups) {
    const supportedHandler = handlers.find(
      (handler) => handler.contractName === group.contractName && handler.supportsDemoCall,
    );

    if (!supportedHandler) {
      continue;
    }

    return {
      httpMethod: supportedHandler.httpMethod,
      routeTemplate: supportedHandler.routeTemplate,
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

const emitRoutesSource = (
  group: ContractGroup,
  handlers: readonly HandlerDescriptor[],
): string => {
  const lines = [
    'import type { Hono } from "hono";',
    'import { type ContractJson, registerRivetHonoRoutes } from "rivet-ts/hono";',
    `import type { ${group.contractName} } from "#contract";`,
  ];

  for (const handler of handlers) {
    lines.push(
      `import { ${handler.useCaseExportName} } from "../../modules/${handler.moduleDirectoryName}/application/${handler.fileBaseName}.js";`,
    );
  }

  const registrationName = `register${toPascalCase(group.contractBaseName)}Routes`;

  lines.push("");
  lines.push(`export const ${registrationName} = (app: Hono, contract: ContractJson): void => {`);
  lines.push(`  registerRivetHonoRoutes<${group.contractName}>(app, contract, {`);
  lines.push(`    group: ${JSON.stringify(group.group)},`);
  lines.push("    handlers: {");
  for (const handler of handlers) {
    const invocation =
      handler.pattern.length === 0
        ? `() => ${handler.useCaseExportName}({})`
        : `(input) => ${handler.useCaseExportName}(input)`;
    lines.push(`      ${JSON.stringify(handler.endpointName)}: ${invocation},`);
  }
  lines.push("    },");
  lines.push("  });");
  lines.push("};");
  lines.push("");

  return lines.join("\n");
};

const emitAppSource = (groups: readonly ContractGroup[]): string => {
  const lines = [
    'import { Hono } from "hono";',
    'import contract from "../generated/api.contract.json" with { type: "json" };',
  ];

  for (const group of groups) {
    lines.push(
      `import { register${toPascalCase(group.contractBaseName)}Routes } from "./interface/http/${group.moduleDirectoryName}-routes.js";`,
    );
  }

  lines.push("");
  lines.push("export const app = new Hono();");
  lines.push("");

  for (const group of groups) {
    lines.push(`register${toPascalCase(group.contractBaseName)}Routes(app, contract);`);
  }

  lines.push("");
  lines.push("// Unhandled handler errors become a structured 500 in BOTH the local");
  lines.push("// (in-browser) transport and a real server — same envelope, same status,");
  lines.push('// keeping the "local now, server later" behavioral parity promise.');
  lines.push("app.onError((error, context) => {");
  lines.push("  console.error(error);");
  lines.push('  return context.json({ code: "internal_error", message: "Unexpected error." }, 500);');
  lines.push("});");
  lines.push("");

  return lines.join("\n");
};

/**
 * Bootstrap OpenAPI document: routes and statuses only, no schemas. It exists
 * so a fresh scaffold has a coherent generated client chain (openapi.json →
 * schema.d.ts) before the first real `task generate`, which overwrites both
 * with artifacts derived from the Rivet binary's full spec — the binary stays
 * the sole real OpenAPI emitter (Option B).
 */
export const buildBootstrapOpenApiDocument = (config: {
  readonly projectName: string;
  readonly document: MockProjectEmitterConfig["document"];
}): object => {
  const paths: Record<string, Record<string, object>> = {};

  for (const endpoint of config.document.endpoints) {
    const responses: Record<string, object> = {};

    for (const response of endpoint.responses) {
      responses[String(response.statusCode)] = response.dataType
        ? {
            description: response.description ?? "Success",
            content: { "application/json": {} },
          }
        : { description: response.description ?? "Success" };
    }

    if (Object.keys(responses).length === 0) {
      responses["200"] = { description: "Success" };
    }

    const route = (paths[endpoint.routeTemplate] ??= {});
    route[endpoint.httpMethod.toLowerCase()] = { responses };
  }

  return {
    openapi: "3.1.0",
    info: { title: config.projectName, version: "0.0.0" },
    paths,
  };
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

    const safetyError = await checkOutDirSafety(config.outDir, config.force ?? false);
    if (safetyError) {
      throw new Error(safetyError);
    }

    const groups = buildContractGroups(config);
    const handlers = buildHandlerDescriptors(config, groups);
    const manifest = await readPackageManifest();

    // The entry (and its local imports) are copied into src/ preserving their
    // relative layout; every reference to the entry derives from where it
    // actually lands — never a hardcoded "contracts.ts" (S4).
    const entryRelativePath = entryDependency.relativePath.split(path.sep).join("/");

    // Copied user files must not silently clobber emitted app files (S6).
    const reservedSourcePaths = new Set(["contract.ts", "local.ts", "main.ts", "app.ts"]);
    for (const dependency of sourceDependencies) {
      const landed = dependency.relativePath.split(path.sep).join("/");
      if (reservedSourcePaths.has(landed)) {
        throw new Error(
          `Entry dependency "${landed}" collides with a scaffold-emitted file in apps/api/src/. ` +
            "Rename the source file and re-run.",
        );
      }
    }

    const workspaceConfig: WorkspaceConfig = {
      outDir: config.outDir,
      projectName: config.projectName,
      packageScope: toPackageScope(config.projectName),
      rivetTsDependency: toRivetTsDependency(manifest),
      versions: resolveWorkspaceVersions(manifest),
      contractEntryRelativePath: entryRelativePath,
      contractNames: groups.map((group) => group.contractName),
      bootstrapOpenApiDocument: buildBootstrapOpenApiDocument(config),
      demoCall: selectDemoClientCall(groups, handlers),
    };

    const { apiSourceRoot } = await emitWorkspaceSkeleton(
      workspaceConfig,
      `${JSON.stringify(config.document, null, 2)}\n`,
    );

    const interfaceHttpRoot = path.join(apiSourceRoot, "interface", "http");
    await fs.mkdir(interfaceHttpRoot, { recursive: true });

    for (const group of groups) {
      await fs.mkdir(path.join(apiSourceRoot, "modules", group.moduleDirectoryName, "application"), {
        recursive: true,
      });
    }

    await Promise.all([
      fs.writeFile(path.join(apiSourceRoot, "app.ts"), emitAppSource(groups)),
      ...groups.map((group) =>
        fs.writeFile(
          path.join(interfaceHttpRoot, `${group.moduleDirectoryName}-routes.ts`),
          emitRoutesSource(
            group,
            handlers.filter((handler) => handler.contractName === group.contractName),
          ),
        ),
      ),
      ...handlers.map((handler) =>
        fs.writeFile(
          path.join(
            apiSourceRoot,
            "modules",
            handler.moduleDirectoryName,
            "application",
            `${handler.fileBaseName}.ts`,
          ),
          emitUseCaseSource(handler),
        ),
      ),
      ...sourceDependencies.map(async (dependency) => {
        const targetPath = path.join(apiSourceRoot, dependency.relativePath);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        const content = await fs.readFile(dependency.absolutePath, "utf8");
        await fs.writeFile(targetPath, content);
      }),
    ]);
  }
}
