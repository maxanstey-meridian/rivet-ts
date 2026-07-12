import fs from "node:fs/promises";
import path from "node:path";
import {
  MockProjectEmitter,
  type MockProjectEmitterConfig,
} from "../../application/ports/mock-project-emitter.js";
import type { RivetType } from "../../domain/rivet-contract.js";
import { toKebabCase } from "../codegen/kebab-case.js";
import { collectLocalDependencies } from "../typescript/local-source-dependencies.js";
import { generateEndpointMock } from "./mock-value-generator.js";
import {
  checkOutDirSafety,
  emitWorkspaceSkeleton,
  toPackageScope,
  type WorkspaceConfig,
} from "./workspace-emitter.js";
import { zodSourceForType } from "./zod-schema-emitter.js";

/**
 * Contract-driven scaffold (`scaffold-mock`): lowers the user's contract entry
 * and emits a golden-shape workspace whose api modules return synthesized mock
 * values. File naming is suffix-free and the HTTP edge is module-local
 * (Meridian §9.1/§9.10): use cases live at `modules/<m>/application/<endpoint>.ts`,
 * route registration at `modules/<m>/<m>-routes.ts`, synthesized schemas at
 * `modules/<m>/<m>-validation.ts`. No `<m>.module.ts` here — mock use cases are
 * standalone functions with nothing to wire, and seams must be earned.
 */

type ContractGroup = {
  readonly contractName: string;
  /** Exported interface identifier — the only name valid in `import type` positions. */
  readonly contractExportName: string;
  readonly contractBaseName: string;
  readonly group: string;
  readonly moduleDirectoryName: string;
  readonly routeRegistrationName: string;
  readonly endpointNames: readonly string[];
};

type HandlerDescriptor = {
  readonly endpointName: string;
  readonly runtimeEndpointName: string;
  readonly httpMethod: string;
  readonly routeTemplate: string;
  readonly group: string;
  readonly contractName: string;
  readonly contractExportName: string;
  readonly moduleDirectoryName: string;
  readonly fileBaseName: string;
  readonly useCaseExportName: string;
  readonly pattern: string;
  readonly body: string;
  readonly supportsDemoCall: boolean;
  readonly hasBody: boolean;
  readonly bodyType?: RivetType;
};

type PackageManifest = {
  readonly version?: string;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
};

const RIVET_TS_DEPENDENCY_REPOSITORY = "github:maxanstey-meridian/rivet-ts";

const RESERVED_IDENTIFIERS = new Set([
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

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

export const toSafeIdentifier = (value: string): string => {
  const normalized = toCamelCase(value);
  const identifier = /^[A-Za-z_$]/u.test(normalized) ? normalized : `_${normalized}`;
  return RESERVED_IDENTIFIERS.has(identifier) ? `${identifier}Endpoint` : identifier;
};

const toSafeTypeIdentifier = (value: string): string => {
  const normalized = toPascalCase(value);
  return /^[A-Za-z_$]/u.test(normalized) ? normalized : `_${normalized}`;
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
    const moduleDirectoryName = toKebabCase(contractBaseName) || "contract";
    const normalizedRouteBaseName = toPascalCase(contractBaseName);
    const routeBaseName = normalizedRouteBaseName
      ? toSafeTypeIdentifier(normalizedRouteBaseName)
      : "Contract";
    const routeRegistrationName = `register${routeBaseName}Routes`;

    return {
      contractName: contract.name,
      contractExportName: contract.exportedName,
      contractBaseName,
      group: deriveGroupName(contract.name),
      moduleDirectoryName,
      routeRegistrationName:
        routeRegistrationName === "registerRivetHonoRoutes"
          ? "registerRivetHonoContractRoutes"
          : routeRegistrationName,
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

      let body: string;
      if (mock.result.kind === "todo" || unsupportedParams.length > 0) {
        const message =
          mock.result.kind === "todo"
            ? mock.result.message
            : `Endpoint "${endpoint.name}" uses unsupported parameter sources in scaffold-mock.`;
        body = [...todoLines, `  throw new Error(${JSON.stringify(message)});`].join("\n");
      } else if (mock.result.kind === "void") {
        body = "  return undefined;";
      } else if (mock.result.kind === "source") {
        body = `  return ${mock.result.source};`;
      } else if (mock.result.kind === "value") {
        const expression = JSON.stringify(mock.result.value, null, 2);
        // Enum members, brands, and example-backed values are not assignable
        // as raw JSON literals; the cast keeps the mock honest about being a
        // mock while letting a fresh scaffold pass its own typecheck.
        const cast = mock.result.needsCast
          ? ` as import("rivet-ts").RivetHandlerResult<import("#contract").${group.contractExportName}, ${JSON.stringify(endpointName)}>`
          : "";
        body = `  return ${indent(expression, 2).trimStart()}${cast};`;
      } else {
        throw new Error(`Unhandled mock result for endpoint "${endpoint.name}".`);
      }

      const bodyParam = endpoint.params.find((param) => param.source === "body");
      descriptors.push({
        endpointName,
        runtimeEndpointName,
        httpMethod: endpoint.httpMethod.toUpperCase(),
        routeTemplate: endpoint.routeTemplate,
        group: group.group,
        contractName: group.contractName,
        contractExportName: group.contractExportName,
        moduleDirectoryName: group.moduleDirectoryName,
        fileBaseName: toKebabCase(endpointName) || "endpoint",
        useCaseExportName: toSafeIdentifier(endpointName),
        pattern,
        body,
        supportsDemoCall: supportedSources.length === 0 && mock.result.kind === "value",
        hasBody: patternParts.includes("body"),
        bodyType: bodyParam?.type,
      });
    }
  }

  return descriptors;
};

const assertUniqueGeneratedHandlerNames = (handlers: readonly HandlerDescriptor[]): void => {
  const identifiers = new Map<string, HandlerDescriptor>();
  const files = new Map<string, HandlerDescriptor>();
  const collisions: string[] = [];

  for (const handler of handlers) {
    const scope = handler.moduleDirectoryName;
    const identifierKey = `${scope}:${handler.useCaseExportName}`;
    const existingIdentifier = identifiers.get(identifierKey);
    if (existingIdentifier) {
      collisions.push(
        `endpoints "${existingIdentifier.endpointName}" and "${handler.endpointName}" in contract "${handler.contractName}" generate the same identifier "${handler.useCaseExportName}"`,
      );
    } else {
      identifiers.set(identifierKey, handler);
    }

    const fileKey = `${scope}:${handler.fileBaseName}`;
    const existingFile = files.get(fileKey);
    if (existingFile) {
      collisions.push(
        `endpoints "${existingFile.endpointName}" and "${handler.endpointName}" in contract "${handler.contractName}" generate the same file "${handler.fileBaseName}.ts"`,
      );
    } else {
      files.set(fileKey, handler);
    }
  }

  if (collisions.length > 0) {
    throw new Error(`Scaffold endpoint name collisions: ${collisions.join("; ")}.`);
  }
};

const assertUniqueRouteModuleBindings = (
  groups: readonly ContractGroup[],
  handlers: readonly HandlerDescriptor[],
): void => {
  const collisions: string[] = [];

  for (const group of groups) {
    const groupHandlers = handlers.filter((handler) => handler.contractName === group.contractName);
    const bodyHandlers = groupHandlers.filter((handler) => handler.hasBody && handler.bodyType);
    const bindings = new Map<string, string>();
    const importedBindings = [
      ["Hono", 'framework import "Hono"'],
      ["ContractJson", 'runtime import "ContractJson"'],
      ["registerRivetHonoRoutes", 'runtime import "registerRivetHonoRoutes"'],
      [group.contractExportName, `contract import "${group.contractExportName}"`],
      [group.routeRegistrationName, `route registration "${group.routeRegistrationName}"`],
      ...(bodyHandlers.length > 0
        ? [
            ["rivetHttpError", 'runtime import "rivetHttpError"'],
            ["z", 'validation import "z"'],
          ]
        : []),
      ...groupHandlers.map(
        (handler) =>
          [handler.useCaseExportName, `endpoint "${handler.endpointName}" handler`] as const,
      ),
      ...bodyHandlers.map(
        (handler) =>
          [schemaExportName(handler), `endpoint "${handler.endpointName}" schema`] as const,
      ),
    ] as const;

    for (const [binding, source] of importedBindings) {
      const existing = bindings.get(binding);
      if (existing) {
        collisions.push(
          `contract "${group.contractName}" imports ${existing} and ${source} as the same route-module binding "${binding}"`,
        );
      } else {
        bindings.set(binding, source);
      }
    }
  }

  if (collisions.length > 0) {
    throw new Error(`Scaffold route-module scope collisions: ${collisions.join("; ")}.`);
  }
};

const assertUniqueGeneratedGroupNames = (
  groups: readonly ContractGroup[],
  handlers: readonly HandlerDescriptor[],
): void => {
  const artifacts = new Map<string, ContractGroup>();
  const collisions: string[] = [];

  for (const group of groups) {
    const generatedArtifacts = [
      ["module directory", group.moduleDirectoryName],
      ["route registration identifier", group.routeRegistrationName],
      ["route file", `${group.moduleDirectoryName}-routes.ts`],
    ];
    if (
      handlers.some(
        (handler) =>
          handler.contractName === group.contractName && handler.hasBody && handler.bodyType,
      )
    ) {
      generatedArtifacts.push(["validation file", `${group.moduleDirectoryName}-validation.ts`]);
    }

    for (const [artifactType, generatedName] of generatedArtifacts) {
      const key = `${artifactType}:${generatedName}`;
      const existing = artifacts.get(key);
      if (existing) {
        collisions.push(
          `contracts "${existing.contractName}" and "${group.contractName}" generate the same ${artifactType} "${generatedName}"`,
        );
      } else {
        artifacts.set(key, group);
      }
    }
  }

  if (collisions.length > 0) {
    throw new Error(`Scaffold contract name collisions: ${collisions.join("; ")}.`);
  }
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
  return [
    `export const ${descriptor.useCaseExportName} = async (_input: import("rivet-ts").RivetHandlerInput<import("#contract").${descriptor.contractExportName}, ${JSON.stringify(descriptor.endpointName)}>): Promise<import("rivet-ts").RivetHandlerResult<import("#contract").${descriptor.contractExportName}, ${JSON.stringify(descriptor.endpointName)}>> => {`,
    descriptor.body,
    "};",
    "",
  ].join("\n");
};

const schemaExportName = (handler: HandlerDescriptor): string =>
  `${handler.useCaseExportName}Request`;

/**
 * Synthesized Zod schemas per body-carrying endpoint — scaffold-time emitted,
 * owned thereafter. When synthesis is provably exact, the schema is locked to
 * the contract type with `satisfies` so later shape drift is a tsc error.
 */
const emitValidationSource = (
  group: ContractGroup,
  bodyHandlers: readonly HandlerDescriptor[],
  config: MockProjectEmitterConfig,
): string => {
  const schemas = bodyHandlers.map((handler) => ({
    handler,
    schema: zodSourceForType(handler.bodyType!, config.document),
  }));
  const lines = ['import { z } from "zod";'];
  lines.push("");
  lines.push("// Synthesized from the contract at scaffold time — owned by you now. Add");
  lines.push("// the rules the contract can't express (lengths, trims, formats); the");
  lines.push("// `satisfies` lock keeps shape drift a compile error.");

  for (const { handler, schema } of schemas) {
    const lock = schema.exact
      ? ` satisfies z.ZodType<import("rivet-ts").RivetHandlerInput<import("#contract").${group.contractExportName}, ${JSON.stringify(handler.endpointName)}>["body"]>`
      : "";
    lines.push(`export const ${schemaExportName(handler)} = ${schema.source}${lock};`);
    lines.push("");
  }

  return lines.join("\n");
};

const emitValidationBarrelSource = (
  groupsWithBodies: readonly ContractGroup[],
  handlers: readonly HandlerDescriptor[],
): string => {
  const header = [
    "// Stable home of the package's `./validation` export — module schemas may",
    "// move; this path may not (frontend consumers import through it).",
  ];
  if (groupsWithBodies.length === 0) {
    return `${header.join("\n")}\nexport {};\n`;
  }
  const entries = groupsWithBodies.flatMap((group) =>
    handlers
      .filter(
        (handler) =>
          handler.contractName === group.contractName && handler.hasBody && handler.bodyType,
      )
      .map((handler) => ({ group, exportName: schemaExportName(handler) })),
  );
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.exportName, (counts.get(entry.exportName) ?? 0) + 1);
  }

  const exportedNames = new Set<string>();
  const exports = entries.map(({ group, exportName }) => {
    const publicName =
      counts.get(exportName) === 1
        ? exportName
        : `${toSafeIdentifier(group.contractBaseName)}${toSafeTypeIdentifier(exportName)}`;
    if (exportedNames.has(publicName)) {
      throw new Error(`Scaffold validation export collision: "${publicName}".`);
    }
    exportedNames.add(publicName);
    const alias = publicName === exportName ? "" : ` as ${publicName}`;
    return `export { ${exportName}${alias} } from "./modules/${group.moduleDirectoryName}/${group.moduleDirectoryName}-validation.js";`;
  });

  return `${header.join("\n")}\n${exports.join("\n")}\n`;
};

const emitRoutesSource = (
  group: ContractGroup,
  handlers: readonly HandlerDescriptor[],
  config: MockProjectEmitterConfig,
): string => {
  const bodyHandlers = handlers.filter((handler) => handler.hasBody && handler.bodyType);
  const lines = ['import type { Hono } from "hono";'];

  if (bodyHandlers.length > 0) {
    lines.push(
      'import { type ContractJson, registerRivetHonoRoutes, rivetHttpError } from "rivet-ts/hono";',
    );
    lines.push('import { z } from "zod";');
  } else {
    lines.push('import { type ContractJson, registerRivetHonoRoutes } from "rivet-ts/hono";');
  }
  lines.push(`import type { ${group.contractExportName} } from "#contract";`);

  for (const handler of handlers) {
    const applicationPath =
      handler.moduleDirectoryName === group.moduleDirectoryName
        ? `./application/${handler.fileBaseName}.js`
        : `../${handler.moduleDirectoryName}/application/${handler.fileBaseName}.js`;
    lines.push(`import { ${handler.useCaseExportName} } from "${applicationPath}";`);
  }
  if (bodyHandlers.length > 0) {
    lines.push(
      `import { ${bodyHandlers.map(schemaExportName).join(", ")} } from "./${group.moduleDirectoryName}-validation.js";`,
    );
  }

  lines.push("");
  lines.push(
    `export const ${group.routeRegistrationName} = (app: Hono, contract: ContractJson): void => {`,
  );
  lines.push(`  registerRivetHonoRoutes<${group.contractExportName}>(app, contract, {`);
  lines.push(`    group: ${JSON.stringify(group.group)},`);
  lines.push("    handlers: {");
  for (const handler of handlers) {
    if (handler.hasBody && handler.bodyType) {
      const exact = zodSourceForType(handler.bodyType, config.document).exact;
      lines.push(`      ${JSON.stringify(handler.endpointName)}: async (input) => {`);
      lines.push("        // The wire is untrusted: parse before the use case sees it.");
      lines.push(`        const result = ${schemaExportName(handler)}.safeParse(input.body);`);
      lines.push("        if (!result.success) {");
      lines.push("          throw rivetHttpError(422, {");
      lines.push('            code: "validation_failed",');
      lines.push('            message: "Validation failed.",');
      lines.push("            errors: z.flattenError(result.error).fieldErrors,");
      lines.push("          });");
      lines.push("        }");
      if (exact) {
        lines.push("        // The schema is exact, so the parsed value (with Zod transforms");
        lines.push("        // applied) IS the contract body — forward it, not the raw wire.");
        lines.push(`        return ${handler.useCaseExportName}({ ...input, body: result.data });`);
      } else {
        lines.push("        // The synthesized schema is shape-approximate (see the TODO in");
        lines.push("        // the validation file): parsing strips unknown keys, so forward");
        lines.push("        // the original body until the schema is made exact.");
        lines.push(`        return ${handler.useCaseExportName}(input);`);
      }
      lines.push("      },");
      continue;
    }
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
      `import { ${group.routeRegistrationName} } from "./modules/${group.moduleDirectoryName}/${group.moduleDirectoryName}-routes.js";`,
    );
  }

  lines.push("");
  lines.push("export const app = new Hono();");
  lines.push("");

  for (const group of groups) {
    lines.push(`${group.routeRegistrationName}(app, contract);`);
  }

  lines.push("");
  lines.push("// Unhandled handler errors become a structured 500 in BOTH the local");
  lines.push("// (in-browser) transport and a real server — same envelope, same status,");
  lines.push('// keeping the "local now, server later" behavioral parity promise.');
  lines.push("app.onError((error, context) => {");
  lines.push("  console.error(error);");
  lines.push(
    '  return context.json({ code: "internal_error", message: "Unexpected error." }, 500);',
  );
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

export class FileSystemMockProjectEmitter implements MockProjectEmitter {
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
    assertUniqueGeneratedGroupNames(groups, handlers);
    assertUniqueGeneratedHandlerNames(handlers);
    assertUniqueRouteModuleBindings(groups, handlers);
    const manifest = await readPackageManifest();

    // The entry (and its local imports) are copied into src/ preserving their
    // relative layout; every reference to the entry derives from where it
    // actually lands — never a hardcoded "contracts.ts" (S4).
    const entryRelativePath = entryDependency.relativePath.split(path.sep).join("/");

    // Copied user files must not silently clobber emitted app files (S6).
    const reservedSourcePaths = new Set([
      "contract.ts",
      "local.ts",
      "main.ts",
      "app.ts",
      "validation.ts",
    ]);
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
      // The facade re-exports TYPE identifiers, so it needs the exported
      // interface names — the brand strings do not resolve.
      contractNames: groups.map((group) => group.contractExportName),
      bootstrapOpenApiDocument: buildBootstrapOpenApiDocument(config),
      demoCall: selectDemoClientCall(groups, handlers),
    };

    const { apiSourceRoot } = await emitWorkspaceSkeleton(
      workspaceConfig,
      `${JSON.stringify(config.document, null, 2)}\n`,
    );

    const groupsWithBodies = groups.filter((group) =>
      handlers.some(
        (handler) =>
          handler.contractName === group.contractName && handler.hasBody && handler.bodyType,
      ),
    );

    for (const group of groups) {
      await fs.mkdir(
        path.join(apiSourceRoot, "modules", group.moduleDirectoryName, "application"),
        {
          recursive: true,
        },
      );
    }

    await Promise.all([
      fs.writeFile(path.join(apiSourceRoot, "app.ts"), emitAppSource(groups)),
      fs.writeFile(
        path.join(apiSourceRoot, "validation.ts"),
        emitValidationBarrelSource(groupsWithBodies, handlers),
      ),
      ...groupsWithBodies.map((group) =>
        fs.writeFile(
          path.join(
            apiSourceRoot,
            "modules",
            group.moduleDirectoryName,
            `${group.moduleDirectoryName}-validation.ts`,
          ),
          emitValidationSource(
            group,
            handlers.filter(
              (handler) =>
                handler.contractName === group.contractName && handler.hasBody && handler.bodyType,
            ),
            config,
          ),
        ),
      ),
      ...groups.map((group) =>
        fs.writeFile(
          path.join(
            apiSourceRoot,
            "modules",
            group.moduleDirectoryName,
            `${group.moduleDirectoryName}-routes.ts`,
          ),
          emitRoutesSource(
            group,
            handlers.filter((handler) => handler.contractName === group.contractName),
            config,
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
