import path from "node:path";
import ts from "typescript";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import {
  RivetContractLoweringResult,
  type ContractEnumDeclaration,
  type ContractSourcePathAliases,
} from "../../domain/rivet-contract-lowering-result.js";
import {
  RivetContractDocument,
  RivetTypeDefinition,
  type RivetContractEnum,
  type RivetEndpointDefinition,
  type RivetEndpointParam,
  type RivetType,
} from "../../domain/rivet-contract.js";
import {
  createNodeDiagnostic,
  hasModifier,
  type LoweringContext,
  type SupportedDeclaration,
} from "./authoring-syntax.js";
import {
  discoverContracts,
  indexDeclarations,
  toDiscoveredContract,
} from "./contract-discovery.js";
import { lowerEndpoint } from "./endpoint-lowering.js";
import {
  collectTypeReferences,
  getDefinitionReferences,
  lowerNamedDeclaration,
} from "./type-lowering.js";
import { mapTypeScriptDiagnostics, resolveTypeScriptProject } from "./typescript-project.js";

const EMPTY_DOCUMENT = new RivetContractDocument({});

/**
 * One pass from a TypeScript entry file to the Rivet contract document: one
 * tsconfig parse, one ts.Program and one checker shared by contract discovery
 * and lowering.
 */
export const lowerContracts = (
  entryPath: string,
  options: { readonly tsconfigPath?: string } = {},
): RivetContractLoweringResult => {
  const project = resolveTypeScriptProject(entryPath, options.tsconfigPath);
  const absoluteEntryPath = project.absoluteEntryPath;
  const program = ts.createProgram([absoluteEntryPath], project.compilerOptions);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(absoluteEntryPath);
  const diagnostics = [
    ...mapTypeScriptDiagnostics(project.configDiagnostics, absoluteEntryPath),
    ...mapTypeScriptDiagnostics(ts.getPreEmitDiagnostics(program), absoluteEntryPath),
  ];

  if (!sourceFile) {
    diagnostics.push(
      new ExtractionDiagnostic({
        severity: "error",
        code: "ENTRY_NOT_FOUND",
        message: `Could not load entry file: ${absoluteEntryPath}`,
        filePath: absoluteEntryPath,
      }),
    );

    return new RivetContractLoweringResult({
      document: EMPTY_DOCUMENT,
      diagnostics,
    });
  }

  const declarations = indexDeclarations(program, checker, diagnostics);
  const typeDefinitions = new Map<string, RivetTypeDefinition>();
  const enums = new Map<string, RivetContractEnum>();
  const endpoints: RivetEndpointDefinition[] = [];
  const endpointNames = new Map<RivetEndpointDefinition, string>();
  const referencedTypeNames = new Set<string>();
  const ctx: LoweringContext = { checker, declarations, diagnostics, dateTypes: new Map() };
  const contracts = discoverContracts(ctx, sourceFile);

  for (const contract of contracts) {
    for (const endpoint of contract.endpoints) {
      const loweredEndpoint = lowerEndpoint(ctx, endpoint);
      endpoints.push(loweredEndpoint);
      endpointNames.set(loweredEndpoint, `${endpoint.contractName}.${endpoint.name}`);
      for (const parameter of loweredEndpoint.params) {
        collectTypeReferences(parameter.type, referencedTypeNames);
      }
      if (loweredEndpoint.returnType) {
        collectTypeReferences(loweredEndpoint.returnType, referencedTypeNames);
      }
      for (const response of loweredEndpoint.responses) {
        if (response.dataType) {
          collectTypeReferences(response.dataType, referencedTypeNames);
        }
      }
    }
  }

  const queue = [...referencedTypeNames].sort();
  const queued = new Set(queue);
  while (queue.length > 0) {
    const name = queue.shift();
    if (!name || typeDefinitions.has(name) || enums.has(name)) {
      continue;
    }

    const lowered = lowerNamedDeclaration(ctx, name);
    if (!lowered) {
      continue;
    }

    if (!(lowered instanceof RivetTypeDefinition)) {
      enums.set(name, lowered);
      continue;
    }

    typeDefinitions.set(name, lowered);
    for (const reference of getDefinitionReferences(lowered)) {
      if (typeDefinitions.has(reference) || enums.has(reference) || queued.has(reference)) {
        continue;
      }

      queue.push(reference);
      queued.add(reference);
    }
  }

  for (const endpoint of endpoints) {
    reportDateInputs(ctx, endpointNames.get(endpoint) ?? endpoint.name, endpoint, typeDefinitions);
  }

  const document = new RivetContractDocument({
    types: [...typeDefinitions.values()].sort((left, right) => left.name.localeCompare(right.name)),
    enums: [...enums.values()].sort((left, right) => left.name.localeCompare(right.name)),
    endpoints,
  });

  const sourceFilePaths = program
    .getSourceFiles()
    .filter((file) => !file.isDeclarationFile && !program.isSourceFileFromExternalLibrary(file))
    .map((file) => path.resolve(file.fileName))
    .filter((filePath) => isProjectFile(project.projectDirectory, filePath));
  const sourceRoot = commonDirectory(sourceFilePaths);

  return new RivetContractLoweringResult({
    document,
    diagnostics,
    contracts: contracts.map(toDiscoveredContract),
    sourceFiles: [...sourceFilePaths].sort().map((absolutePath) => ({
      absolutePath,
      relativePath: toPosixRelativePath(sourceRoot, absolutePath),
    })),
    sourcePathAliases: toSourcePathAliases(project.compilerOptions, sourceRoot),
    enumDeclarations: toEnumDeclarations(document.enums, declarations, sourceFilePaths, sourceRoot),
    dateTypes: new Set(ctx.dateTypes.keys()),
  });
};

const PARAM_PATH_ROOTS: Readonly<Record<RivetEndpointParam["source"], string>> = {
  body: "body",
  file: "file",
  formField: "form",
  query: "query",
  route: "route",
};

/**
 * A TS `Date` anywhere in an endpoint's input is an error: a request carries
 * it as a string, and nothing between the wire and the handler (route and
 * query binding, `req.json()`, the scaffold's validator) makes it a `Date`
 * again, so the handler would receive a string its type calls a `Date`.
 * Reported once per `Date` and endpoint, at the reference that wrote it.
 */
const reportDateInputs = (
  ctx: LoweringContext,
  endpointName: string,
  endpoint: RivetEndpointDefinition,
  typeDefinitions: ReadonlyMap<string, RivetTypeDefinition>,
): void => {
  const reported = new Set<RivetType>();
  const visit = (type: RivetType, path: string, entered: ReadonlySet<string>): void => {
    const enter = (name: string, typeArgs: readonly RivetType[]): void => {
      for (const typeArg of typeArgs) {
        visit(typeArg, path, entered);
      }
      const definition = typeDefinitions.get(name);
      if (!definition || entered.has(name)) {
        return;
      }
      const inside = new Set(entered).add(name);
      if (definition.type) {
        visit(definition.type, path, inside);
      }
      for (const property of definition.properties) {
        visit(property.type, `${path}.${property.name}`, inside);
      }
    };

    switch (type.kind) {
      case "primitive": {
        const node = ctx.dateTypes.get(type);
        if (node && !reported.has(type)) {
          reported.add(type);
          ctx.diagnostics.push(
            createNodeDiagnostic(
              node,
              "DATE_IN_REQUEST",
              `Endpoint "${endpointName}" receives a Date at ${path}, but a request carries it as a string and the handler would get that string unconverted. Declare it as Format<string, "date-time">.`,
            ),
          );
        }
        return;
      }
      case "nullable":
        return visit(type.inner, path, entered);
      case "array":
        return visit(type.element, `${path}[]`, entered);
      case "dictionary":
        return visit(type.value, `${path}[key]`, entered);
      case "brand":
        return visit(type.underlying, path, entered);
      case "ref":
        return enter(type.name, []);
      case "generic":
        return enter(type.name, type.typeArgs);
      case "inlineObject":
        for (const property of type.properties) {
          visit(property.type, `${path}.${property.name}`, entered);
        }
        return;
      case "union":
        for (const variant of type.variants) {
          visit(variant, path, entered);
        }
        return;
      case "taggedUnion":
        for (const variant of type.variants) {
          visit(variant.type, path, entered);
        }
        return;
      case "stringUnion":
      case "intUnion":
      case "literal":
      case "typeParam":
        return;
    }
  };

  for (const param of endpoint.params) {
    const root = PARAM_PATH_ROOTS[param.source];
    visit(param.type, param.source === "body" ? root : `${root}.${param.name}`, new Set());
  }
};

/** An enum member's name as `Enum[name]` reads it: `["a"] = 1` is the member `a`. */
const enumMemberName = (name: ts.PropertyName): string => {
  const key = ts.isComputedPropertyName(name) ? name.expression : name;
  return ts.isStringLiteralLike(key) || ts.isIdentifier(key) ? key.text : key.getText();
};

/**
 * The document enums declared as TS `enum`s, each member paired with its
 * lowered value (lowering keeps declaration order).
 */
const toEnumDeclarations = (
  enums: readonly RivetContractEnum[],
  declarations: ReadonlyMap<string, SupportedDeclaration>,
  sourceFilePaths: readonly string[],
  sourceRoot: string,
): ContractEnumDeclaration[] =>
  enums.flatMap((entry) => {
    const declaration = declarations.get(entry.name);
    if (!declaration || !ts.isEnumDeclaration(declaration)) {
      return [];
    }
    const declaringFile = path.resolve(declaration.getSourceFile().fileName);
    const values: readonly (string | number)[] = "values" in entry ? entry.values : entry.intValues;
    return [
      {
        name: entry.name,
        source: hasModifier(declaration, ts.ModifierFlags.Ambient)
          ? { kind: "ambient" }
          : sourceFilePaths.includes(declaringFile)
            ? { kind: "module", relativePath: toPosixRelativePath(sourceRoot, declaringFile) }
            : { kind: "outsideContractSources" },
        members: declaration.members.flatMap((member, index) => {
          const value = values[index];
          return value === undefined ? [] : [{ name: enumMemberName(member.name), value }];
        }),
      },
    ];
  });

const isWithin = (directory: string, candidate: string): boolean => {
  const relative = path.relative(directory, candidate);
  return !(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
};

/**
 * A tsconfig's `paths` can map a package to its source outside the project
 * (as `templates/tsconfig.json` maps rivet-ts to `src/`); those files are the
 * library's, not the contract's. Without a tsconfig there are no `paths`, so
 * every compiled source file was reached by the contract's own relative imports.
 */
const isProjectFile = (projectDirectory: string | undefined, filePath: string): boolean =>
  projectDirectory === undefined || isWithin(projectDirectory, filePath);

const commonDirectory = (filePaths: readonly string[]): string => {
  let root = filePaths.length > 0 ? path.dirname(filePaths[0]) : "";
  for (const filePath of filePaths) {
    while (!isWithin(root, filePath) && path.dirname(root) !== root) {
      root = path.dirname(root);
    }
  }
  return root;
};

const toPosixRelativePath = (root: string, absolutePath: string): string =>
  path.relative(root, absolutePath).split(path.sep).join("/");

/**
 * Rebases the `paths` targets that lie under the source root, so a copy of the
 * contract sources can resolve the same aliases. `paths` resolve against
 * `baseUrl`, else against the directory of the tsconfig that declared them,
 * which TypeScript records as `pathsBasePath` when it follows `extends`.
 */
const toSourcePathAliases = (
  options: ts.CompilerOptions,
  sourceRoot: string,
): ContractSourcePathAliases => {
  const { baseUrl, paths, pathsBasePath } = options;
  const base = baseUrl ?? (typeof pathsBasePath === "string" ? pathsBasePath : undefined);
  if (paths === undefined || base === undefined || sourceRoot === "") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(paths).flatMap(([pattern, targets]) => {
      const rebased = targets
        .map((target) => path.resolve(base, target))
        .filter((target) => isWithin(sourceRoot, target))
        .map((target) => toPosixRelativePath(sourceRoot, target));
      return rebased.length > 0 ? [[pattern, rebased] as const] : [];
    }),
  );
};
