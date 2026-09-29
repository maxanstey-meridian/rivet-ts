import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type {
  ContractSourceFile,
  DiscoveredContract,
  DiscoveredEndpoint,
} from "../../domain/rivet-contract-lowering-result.js";
import type {
  RivetContractDocument,
  RivetEndpointDefinition,
} from "../../domain/rivet-contract.js";
import { toKebabCase } from "../codegen/kebab-case.js";
import { generateEndpointMock } from "./mock-value-generator.js";
import {
  assertOutDirWritable,
  emitWorkspace,
  readTemplateTree,
  type WorkspaceConfig,
} from "./workspace-emitter.js";
import { zodSourceForType, type ZodSourceResult } from "./zod-schema-emitter.js";

/**
 * Contract-driven scaffold (`scaffold-mock`): emits a golden-shape workspace
 * whose api modules return synthesized mock values. Use cases live at
 * `modules/<m>/application/<endpoint>.ts`, route registration at
 * `modules/<m>/<m>-routes.ts`, synthesized schemas at
 * `modules/<m>/<m>-validation.ts`. There is no `<m>.module.ts`: mock use cases
 * are standalone functions with nothing to wire.
 */

export type MockProjectConfig = {
  readonly outDir: string;
  readonly projectName: string;
  readonly entryPath: string;
  readonly force: boolean;
  readonly contracts: readonly DiscoveredContract[];
  readonly sourceFiles: readonly ContractSourceFile[];
  readonly document: RivetContractDocument;
};

type HandlerDescriptor = {
  /** Authored endpoint key: the handler-map key and the `RivetHandlerInput` key. */
  readonly endpointName: string;
  readonly httpMethod: string;
  readonly routeTemplate: string;
  readonly fileBaseName: string;
  readonly useCaseExportName: string;
  readonly takesInput: boolean;
  readonly body: string;
  readonly supportsDemoCall: boolean;
  /** Present when the handler receives a JSON body the route validates. */
  readonly bodySchema?: ZodSourceResult;
};

type ContractGroup = {
  readonly contractName: string;
  /** Exported interface identifier — the only name valid in `import type` positions. */
  readonly contractExportName: string;
  readonly contractBaseName: string;
  readonly controllerName: string;
  readonly moduleDirectoryName: string;
  readonly routeRegistrationName: string;
  readonly handlers: readonly HandlerDescriptor[];
};

const wordScanner = ts.createScanner(ts.ScriptTarget.ESNext, true);

/** Names that cannot bind a module-level `const` in strict-mode ES modules. */
const isReservedBindingName = (value: string): boolean => {
  wordScanner.setText(value);
  const token = wordScanner.scan();
  return (
    (token >= ts.SyntaxKind.FirstReservedWord && token <= ts.SyntaxKind.LastReservedWord) ||
    (token >= ts.SyntaxKind.FirstFutureReservedWord &&
      token <= ts.SyntaxKind.LastFutureReservedWord) ||
    value === "arguments" ||
    value === "await" ||
    value === "eval"
  );
};

/** Whether a toCamelCase/toPascalCase result (ASCII letters and digits) can start an identifier. */
const startsIdentifier = (value: string): boolean =>
  ts.isIdentifierStart(value.charCodeAt(0), ts.ScriptTarget.ESNext);

const toCamelCase = (value: string): string =>
  toKebabCase(value)
    .split("-")
    .filter((segment) => segment.length > 0)
    .map((segment, index) =>
      index === 0 ? segment : `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`,
    )
    .join("");

const toPascalCase = (value: string): string => {
  const camel = toCamelCase(value);
  return `${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
};

export const toSafeIdentifier = (value: string): string => {
  const normalized = toCamelCase(value);
  const identifier = startsIdentifier(normalized) ? normalized : `_${normalized}`;
  return isReservedBindingName(identifier) ? `${identifier}Endpoint` : identifier;
};

const toSafeTypeIdentifier = (value: string): string => {
  const normalized = toPascalCase(value);
  return startsIdentifier(normalized) ? normalized : `_${normalized}`;
};

const deriveContractBaseName = (contractName: string): string =>
  contractName.endsWith("Contract") ? contractName.slice(0, -1 * "Contract".length) : contractName;

const indent = (value: string, spaces: number): string => {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
};

/** `import("rivet-ts").RivetHandler<Part><Contract, "Endpoint">`, resolvable in any scaffold module. */
const handlerType = (
  part: "Input" | "Result",
  contractExportName: string,
  endpointName: string,
): string =>
  `import("rivet-ts").RivetHandler${part}<import("#contract").${contractExportName}, ${JSON.stringify(endpointName)}>`;

const isSupportedParamSource = (source: string): boolean =>
  source === "body" || source === "route" || source === "query";

const buildHandlerDescriptor = (
  contract: DiscoveredContract,
  spec: DiscoveredEndpoint,
  endpoint: RivetEndpointDefinition,
  document: RivetContractDocument,
): HandlerDescriptor => {
  // The handler signature mirrors the type-level RivetHandlerInput bag, which
  // derives from the authored spec's input/params/query keys, not from the
  // lowered params: route-template params lower to source "route" but are
  // absent from the handler's input type. `input` is a body only on
  // body-carrying methods; on GET/DELETE the adapter delivers it as `query`.
  const isBodyMethod = /^(PATCH|POST|PUT)$/iu.test(spec.method);
  const takesBody = spec.hasInput && isBodyMethod;
  const takesInput = spec.hasInput || spec.hasParams || spec.hasQuery;

  const mock = generateEndpointMock(endpoint, document);
  const unsupportedParams = endpoint.params.filter(
    (param) => !isSupportedParamSource(param.source),
  );

  let body: string;
  if (mock.result.kind === "todo" || unsupportedParams.length > 0) {
    const todoLines = [
      ...mock.diagnostics.map((diagnostic) => `  // TODO: ${diagnostic.message}`),
      ...unsupportedParams.map(
        (param) =>
          `  // TODO: Endpoint "${endpoint.name}" uses unsupported param source "${param.source}" in scaffold-mock.`,
      ),
    ];
    const message =
      mock.result.kind === "todo"
        ? mock.result.message
        : `Endpoint "${endpoint.name}" uses unsupported parameter sources in scaffold-mock.`;
    body = [...todoLines, `  throw new Error(${JSON.stringify(message)});`].join("\n");
  } else if (mock.result.kind === "void") {
    body = "  return undefined;";
  } else if (mock.result.kind === "source") {
    body = `  return ${mock.result.source};`;
  } else {
    const expression = JSON.stringify(mock.result.value, null, 2);
    // Enum members, brands and example-backed values are not assignable as raw
    // JSON literals; the cast lets a fresh scaffold pass its own typecheck.
    const cast = mock.result.needsCast
      ? ` as ${handlerType("Result", contract.exportedName, spec.name)}`
      : "";
    body = `  return ${indent(expression, 2).trimStart()}${cast};`;
  }

  const bodyParam = endpoint.params.find((param) => param.source === "body");
  return {
    endpointName: spec.name,
    httpMethod: endpoint.httpMethod.toUpperCase(),
    routeTemplate: endpoint.routeTemplate,
    fileBaseName: toKebabCase(spec.name) || "endpoint",
    useCaseExportName: toSafeIdentifier(spec.name),
    takesInput,
    body,
    supportsDemoCall:
      !endpoint.params.some((param) => isSupportedParamSource(param.source)) &&
      mock.result.kind === "value",
    bodySchema: takesBody && bodyParam ? zodSourceForType(bodyParam.type, document) : undefined,
  };
};

const buildContractGroups = (config: MockProjectConfig): readonly ContractGroup[] => {
  const endpointsByKey = new Map(
    config.document.endpoints.map((endpoint) => [
      `${endpoint.controllerName}:${endpoint.name}`,
      endpoint,
    ]),
  );

  return config.contracts.map((contract) => {
    const contractBaseName = deriveContractBaseName(contract.name);
    const normalizedRouteBaseName = toPascalCase(contractBaseName);
    const routeBaseName = normalizedRouteBaseName
      ? toSafeTypeIdentifier(normalizedRouteBaseName)
      : "Contract";
    const routeRegistrationName = `register${routeBaseName}Routes`;

    return {
      contractName: contract.name,
      contractExportName: contract.exportedName,
      contractBaseName,
      controllerName: contract.controllerName,
      moduleDirectoryName: toKebabCase(contractBaseName) || "contract",
      routeRegistrationName:
        routeRegistrationName === "registerRivetHonoRoutes"
          ? "registerRivetHonoContractRoutes"
          : routeRegistrationName,
      handlers: contract.endpoints.map((spec) => {
        const endpoint = endpointsByKey.get(`${contract.controllerName}:${spec.loweredName}`);
        if (!endpoint) {
          throw new Error(
            `Endpoint "${contract.name}.${spec.name}" is missing from the lowered contract document.`,
          );
        }
        return buildHandlerDescriptor(contract, spec, endpoint, config.document);
      }),
    };
  });
};

/** One message per later entry whose key an earlier entry already claimed. */
const collectCollisions = <TEntry>(
  entries: readonly TEntry[],
  keyOf: (entry: TEntry) => string,
  describe: (first: TEntry, second: TEntry) => string,
): string[] => {
  const claimed = new Map<string, TEntry>();
  const collisions: string[] = [];
  for (const entry of entries) {
    const key = keyOf(entry);
    const first = claimed.get(key);
    if (first === undefined) {
      claimed.set(key, entry);
    } else {
      collisions.push(describe(first, entry));
    }
  }
  return collisions;
};

const throwCollisions = (kind: string, collisions: readonly string[]): void => {
  if (collisions.length > 0) {
    throw new Error(`Scaffold ${kind} collisions: ${collisions.join("; ")}.`);
  }
};

const schemaExportName = (handler: HandlerDescriptor): string =>
  `${handler.useCaseExportName}Request`;

type BodyHandlerDescriptor = HandlerDescriptor & { readonly bodySchema: ZodSourceResult };

const bodyHandlersOf = (group: ContractGroup): readonly BodyHandlerDescriptor[] =>
  group.handlers.filter(
    (handler): handler is BodyHandlerDescriptor => handler.bodySchema !== undefined,
  );

const assertUniqueGeneratedNames = (groups: readonly ContractGroup[]): void => {
  const artifacts = groups.flatMap((group) =>
    [
      ["module directory", group.moduleDirectoryName],
      ["route registration identifier", group.routeRegistrationName],
      ["route file", `${group.moduleDirectoryName}-routes.ts`],
      ...(bodyHandlersOf(group).length > 0
        ? [["validation file", `${group.moduleDirectoryName}-validation.ts`]]
        : []),
    ].map(([artifactType, generatedName]) => ({ group, artifactType, generatedName })),
  );
  throwCollisions(
    "contract name",
    collectCollisions(
      artifacts,
      (artifact) => `${artifact.artifactType}:${artifact.generatedName}`,
      (first, second) =>
        `contracts "${first.group.contractName}" and "${second.group.contractName}" generate the same ${second.artifactType} "${second.generatedName}"`,
    ),
  );

  throwCollisions(
    "endpoint name",
    groups.flatMap((group) => [
      ...collectCollisions(
        group.handlers,
        (handler) => handler.useCaseExportName,
        (first, second) =>
          `endpoints "${first.endpointName}" and "${second.endpointName}" in contract "${group.contractName}" generate the same identifier "${second.useCaseExportName}"`,
      ),
      ...collectCollisions(
        group.handlers,
        (handler) => handler.fileBaseName,
        (first, second) =>
          `endpoints "${first.endpointName}" and "${second.endpointName}" in contract "${group.contractName}" generate the same file "${second.fileBaseName}.ts"`,
      ),
    ]),
  );

  throwCollisions(
    "route-module scope",
    groups.flatMap((group) => {
      const bodyHandlers = bodyHandlersOf(group);
      const bindings: readonly (readonly [binding: string, source: string])[] = [
        ["Hono", 'framework import "Hono"'],
        ["ContractJson", 'runtime import "ContractJson"'],
        ["registerRivetHonoRoutes", 'runtime import "registerRivetHonoRoutes"'],
        [group.contractExportName, `contract import "${group.contractExportName}"`],
        [group.routeRegistrationName, `route registration "${group.routeRegistrationName}"`],
        ...(bodyHandlers.length > 0 ? ([["parseBody", 'edge import "parseBody"']] as const) : []),
        ...group.handlers.map(
          (handler) =>
            [handler.useCaseExportName, `endpoint "${handler.endpointName}" handler`] as const,
        ),
        ...bodyHandlers.map(
          (handler) =>
            [schemaExportName(handler), `endpoint "${handler.endpointName}" schema`] as const,
        ),
      ];
      return collectCollisions(
        bindings,
        ([binding]) => binding,
        ([, first], [binding, second]) =>
          `contract "${group.contractName}" imports ${first} and ${second} as the same route-module binding "${binding}"`,
      );
    }),
  );
};

const selectDemoClientCall = (
  groups: readonly ContractGroup[],
): { readonly httpMethod: string; readonly routeTemplate: string } | undefined =>
  groups.flatMap((group) => group.handlers).find((handler) => handler.supportsDemoCall);

const emitUseCaseSource = (group: ContractGroup, handler: HandlerDescriptor): string =>
  `export const ${handler.useCaseExportName} = async (_input: ${handlerType("Input", group.contractExportName, handler.endpointName)}): Promise<${handlerType("Result", group.contractExportName, handler.endpointName)}> => {
${handler.body}
};
`;

/**
 * Synthesized Zod schemas per body-carrying endpoint — scaffold-time emitted,
 * owned thereafter. When synthesis is provably exact, the schema is locked to
 * the contract type with `satisfies` so later shape drift is a tsc error.
 */
const emitValidationSource = (group: ContractGroup): string => {
  const schemas = bodyHandlersOf(group).map((handler) => {
    const lock = handler.bodySchema.exact
      ? ` satisfies z.ZodType<${handlerType("Input", group.contractExportName, handler.endpointName)}["body"]>`
      : "";
    return `export const ${schemaExportName(handler)} = ${handler.bodySchema.source}${lock};\n`;
  });

  return `import { z } from "zod";

// Synthesized from the contract at scaffold time — owned by you now. Add
// the rules the contract can't express (lengths, trims, formats); the
// \`satisfies\` lock keeps shape drift a compile error.
${schemas.join("\n")}`;
};

const emitValidationBarrelSource = (groups: readonly ContractGroup[]): string => {
  const header = [
    "// Stable home of the package's `./validation` export — module schemas may",
    "// move; this path may not (frontend consumers import through it).",
  ];
  const entries = groups.flatMap((group) =>
    bodyHandlersOf(group).map((handler) => ({ group, exportName: schemaExportName(handler) })),
  );
  if (entries.length === 0) {
    return `${header.join("\n")}\nexport {};\n`;
  }
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

const emitRouteHandlerEntry = (handler: HandlerDescriptor): string => {
  const key = JSON.stringify(handler.endpointName);
  if (!handler.bodySchema) {
    const invocation = handler.takesInput
      ? `(input) => ${handler.useCaseExportName}(input)`
      : `() => ${handler.useCaseExportName}({})`;
    return `      ${key}: ${invocation},`;
  }

  const parse = `parseBody(${schemaExportName(handler)}, input.body)`;
  return handler.bodySchema.exact
    ? `      // The schema is exact, so the parsed value (with Zod transforms applied)
      // IS the contract body — forward it, not the raw wire.
      ${key}: async (input) => ${handler.useCaseExportName}({ ...input, body: ${parse} }),`
    : `      ${key}: async (input) => {
        // The synthesized schema is shape-approximate (see the TODO in the
        // validation file): parsing strips unknown keys, so validate but forward
        // the original body until the schema is made exact.
        ${parse};
        return ${handler.useCaseExportName}(input);
      },`;
};

const emitRoutesSource = (group: ContractGroup): string => {
  const bodyHandlers = bodyHandlersOf(group);
  const imports = [
    'import type { Hono } from "hono";',
    'import { type ContractJson, registerRivetHonoRoutes } from "rivet-ts/hono";',
    `import type { ${group.contractExportName} } from "#contract";`,
    ...(bodyHandlers.length > 0 ? ['import { parseBody } from "../../http-errors.js";'] : []),
    ...group.handlers.map(
      (handler) =>
        `import { ${handler.useCaseExportName} } from "./application/${handler.fileBaseName}.js";`,
    ),
    ...(bodyHandlers.length > 0
      ? [
          `import { ${bodyHandlers.map(schemaExportName).join(", ")} } from "./${group.moduleDirectoryName}-validation.js";`,
        ]
      : []),
  ];

  return `${imports.join("\n")}

export const ${group.routeRegistrationName} = (app: Hono, contract: ContractJson): void => {
  registerRivetHonoRoutes<${group.contractExportName}>(app, contract, {
    group: ${JSON.stringify(group.controllerName)},
    handlers: {
${group.handlers.map(emitRouteHandlerEntry).join("\n")}
    },
  });
};
`;
};

const emitAppSource = (groups: readonly ContractGroup[]): string => `import { Hono } from "hono";
import contract from "../generated/api.contract.json" with { type: "json" };
import { handleUnexpectedError } from "./http-errors.js";
${groups
  .map(
    (group) =>
      `import { ${group.routeRegistrationName} } from "./modules/${group.moduleDirectoryName}/${group.moduleDirectoryName}-routes.js";\n`,
  )
  .join("")}
export const app = new Hono();

${groups.map((group) => `${group.routeRegistrationName}(app, contract);\n`).join("")}
app.onError(handleUnexpectedError);
`;

const LOCAL_SOURCE = 'export { app } from "./app.js";\n';

const MAIN_SOURCE = `import { serve } from "@hono/node-server";
import { app } from "./app.js";

serve({ fetch: app.fetch, port: 5180 }, (info) => {
  console.log(\`api listening on http://localhost:\${info.port}\`);
});
`;

/** Emitted files at the root of `apps/api/src`; copied contract sources must not land on them. */
const API_SOURCE_FILES = [
  "contract.ts",
  "local.ts",
  "main.ts",
  "app.ts",
  "validation.ts",
  "http-errors.ts",
];

export const emitMockProject = async (config: MockProjectConfig): Promise<void> => {
  const entryAbsolutePath = path.resolve(config.entryPath);
  const entryDependency = config.sourceFiles.find(
    (dependency) => dependency.absolutePath === entryAbsolutePath,
  );

  if (!entryDependency) {
    throw new Error(`Could not locate copied entry path for ${config.entryPath}.`);
  }

  await assertOutDirWritable(config.outDir, config.force);

  const groups = buildContractGroups(config);
  assertUniqueGeneratedNames(groups);

  // The entry and its local imports are copied into src/ preserving their
  // relative layout, so every reference to the entry derives from where it lands.
  for (const { relativePath: landed } of config.sourceFiles) {
    if (API_SOURCE_FILES.includes(landed)) {
      throw new Error(
        `Entry dependency "${landed}" collides with a scaffold-emitted file in apps/api/src/. ` +
          "Rename the source file and re-run.",
      );
    }
  }

  const copiedSources = await Promise.all(
    config.sourceFiles.map(
      async (dependency) =>
        [
          `apps/api/src/${dependency.relativePath}`,
          await fs.readFile(dependency.absolutePath, "utf8"),
        ] as const,
    ),
  );

  const workspaceConfig: WorkspaceConfig = {
    outDir: config.outDir,
    projectName: config.projectName,
    variant: "full",
    document: config.document,
    contractEntryRelativePath: entryDependency.relativePath,
    // The facade re-exports TYPE identifiers, so it needs the exported
    // interface names — the brand strings do not resolve.
    contractNames: groups.map((group) => group.contractExportName),
    demoCall: selectDemoClientCall(groups),
  };

  await emitWorkspace(workspaceConfig, {
    ...(await readTemplateTree("shared")),
    "apps/api/src/local.ts": LOCAL_SOURCE,
    "apps/api/src/main.ts": MAIN_SOURCE,
    "apps/api/src/app.ts": emitAppSource(groups),
    "apps/api/src/validation.ts": emitValidationBarrelSource(groups),
    ...Object.fromEntries(
      groups.flatMap((group) => {
        const moduleRoot = `apps/api/src/modules/${group.moduleDirectoryName}`;
        return [
          ...(bodyHandlersOf(group).length > 0
            ? [
                [
                  `${moduleRoot}/${group.moduleDirectoryName}-validation.ts`,
                  emitValidationSource(group),
                ],
              ]
            : []),
          [`${moduleRoot}/${group.moduleDirectoryName}-routes.ts`, emitRoutesSource(group)],
          ...group.handlers.map((handler) => [
            `${moduleRoot}/application/${handler.fileBaseName}.ts`,
            emitUseCaseSource(group, handler),
          ]),
        ];
      }),
    ),
    ...Object.fromEntries(copiedSources),
  });
};
