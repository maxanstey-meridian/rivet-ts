import ts from "typescript";
import type { HttpMethod } from "../../domain/contract.js";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import {
  type DiscoveredContract,
  RivetContractLoweringResult,
} from "../../domain/rivet-contract-lowering-result.js";
import {
  RivetContractDocument,
  type RivetContractEnum,
  RivetEndpointDefinition,
  type RivetEndpointExampleValue,
  RivetEndpointParam,
  RivetEndpointSecurity,
  RivetExample,
  RivetResponseType,
  type RivetType,
  RivetTypeDefinition,
  type RivetPropertyDefinition,
} from "../../domain/rivet-contract.js";
import { mapTypeScriptDiagnostics, resolveTypeScriptProject } from "./typescript-project.js";

type SupportedDeclaration = ts.EnumDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

type DiscoveredEndpointSpec = {
  contractName: string;
  name: string;
  specNode: ts.TypeNode;
  propertyMap: ReadonlyMap<string, ts.TypeNode>;
  method: HttpMethod;
  route: string;
  successStatus: number | null;
  formEncoded: boolean;
  acceptsFile: boolean;
  hasInput: boolean;
  hasParams: boolean;
  hasQuery: boolean;
  fileContentType: string | undefined;
  requestExamples: readonly RivetExample[];
  responseExamples: readonly ResponseExampleGroup[];
};

type ResponseExampleGroup = {
  status: number;
  examples: readonly RivetExample[];
  node: ts.TypeNode;
};

type ExampleReadContext = {
  readonly endpointName: string;
  /** How diagnostics name the authored example slot, e.g. "requestExamples entries". */
  readonly label: string;
  /** Absent for examples that are not type-checked. */
  readonly target?: ExampleTarget;
};

type ExampleTarget = {
  readonly typeNode: ts.TypeNode | undefined;
  readonly property: "input" | "response";
};

type DiscoveredContractSpec = {
  name: string;
  exportedName: string;
  sourceFilePath: string;
  endpoints: readonly DiscoveredEndpointSpec[];
};

type PropertyDescriptor = {
  name: string;
  typeNode: ts.TypeNode;
  optional: boolean;
  readOnly: boolean;
};

type TaggedUnionMemberDescriptor = {
  properties: readonly PropertyDescriptor[];
};

const EMPTY_DOCUMENT = new RivetContractDocument({});

const HTTP_METHODS = new Set<HttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const BODY_HTTP_METHODS = new Set(["PATCH", "POST", "PUT"]);
const ROUTE_PARAM_PATTERN = /\{([^}]+)\}/g;
const AUTHORING_HELPER_TYPE_NAMES = new Set([
  "EndpointAuthoringSpec",
  "EndpointErrorAuthoringSpec",
  "EndpointSecurityAuthoringSpec",
]);
const isListTypeName = (name: string | null): boolean =>
  name === "Array" || name === "ReadonlyArray";
const JSON_MEDIA_TYPE = "application/json";

const getResponseExampleMediaType = (status: number, fileContentType: string | undefined): string =>
  status >= 200 && status < 300 && fileContentType ? fileContentType : JSON_MEDIA_TYPE;

// HTTP forbids a message body on these; C# Rivet refuses authored content there (RIV1102).
const isBodyForbiddenStatus = (status: number): boolean =>
  (status >= 100 && status < 200) || status === 204 || status === 205 || status === 304;

const parseRouteParamNames = (route: string): string[] => {
  const matches = route.matchAll(ROUTE_PARAM_PATTERN);
  return [...matches].map((match) => match[1] ?? "").filter((name) => name.length > 0);
};

const deriveGroupName = (contractName: string): string => {
  const baseName = contractName.endsWith("Contract")
    ? contractName.slice(0, -1 * "Contract".length)
    : contractName;

  if (baseName.length === 0) {
    return baseName;
  }

  return `${baseName[0]?.toLowerCase() ?? ""}${baseName.slice(1)}`;
};

const toCamelCase = (value: string): string => {
  if (value.length === 0) {
    return value;
  }

  return `${value[0]?.toLowerCase() ?? ""}${value.slice(1)}`;
};

const getNodeSourceFile = (node: ts.Node): ts.SourceFile => node.getSourceFile();

const getPropertyName = (name: ts.PropertyName): string | null => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return null;
};

const isNullTypeNode = (node: ts.TypeNode): boolean =>
  ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword;

const hasModifier = (node: ts.Declaration, flag: ts.ModifierFlags): boolean =>
  (ts.getCombinedModifierFlags(node) & flag) !== 0;

const resolveAlias = (checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol =>
  (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;

const resolveSymbol = (checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined => {
  const symbol = checker.getSymbolAtLocation(node);
  return symbol && resolveAlias(checker, symbol);
};

// The authoring types ship as src/domain/authoring-types.ts (this repo's own
// contracts and tests import it) and as dist/domain/authoring-types.d.ts
// (the published package, re-exported by dist/index.d.ts).
const isRivetAuthoringFile = (sourceFile: ts.SourceFile): boolean =>
  /\/(?:src\/domain\/authoring-types\.ts|dist\/domain\/authoring-types\.d\.ts)$/u.test(
    sourceFile.fileName,
  );

/** Whether `node` names the rivet-ts authoring type `name`, through any import alias. */
const isRivetSymbol = (checker: ts.TypeChecker, node: ts.Node, name: string): boolean => {
  const symbol = resolveSymbol(checker, node);
  return (
    symbol?.getName() === name &&
    (symbol.getDeclarations() ?? []).some((declaration) =>
      isRivetAuthoringFile(declaration.getSourceFile()),
    )
  );
};

type LiteralValue = string | number | boolean;

const literalValueOfType = (checker: ts.TypeChecker, type: ts.Type): LiteralValue | null => {
  if (type.isStringLiteral() || type.isNumberLiteral()) {
    return type.value;
  }

  if ((type.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
    return type === checker.getTrueType();
  }

  return null;
};

/** The literal a type node denotes, resolved through aliases (`type Get = "GET"`, `-1`). */
const readLiteral = (checker: ts.TypeChecker, node: ts.TypeNode | undefined): LiteralValue | null =>
  node ? literalValueOfType(checker, checker.getTypeFromTypeNode(node)) : null;

const createNodeDiagnostic = (
  node: ts.Node,
  code: string,
  message: string,
): ExtractionDiagnostic => {
  const sourceFile = getNodeSourceFile(node);
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

  return new ExtractionDiagnostic({
    severity: "error",
    code,
    message,
    filePath: sourceFile.fileName,
    line: position.line + 1,
    column: position.character + 1,
  });
};

const getContractHeritageType = (
  node: ts.InterfaceDeclaration,
  checker: ts.TypeChecker,
): ts.ExpressionWithTypeArguments | null => {
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
      continue;
    }

    for (const type of clause.types) {
      if (isRivetSymbol(checker, type.expression, "Contract")) {
        return type;
      }
    }
  }

  return null;
};

const isContractInterface = (node: ts.InterfaceDeclaration, checker: ts.TypeChecker): boolean =>
  getContractHeritageType(node, checker) !== null;

const getContractName = (node: ts.InterfaceDeclaration, checker: ts.TypeChecker): string | null => {
  const [argument] = getContractHeritageType(node, checker)?.typeArguments ?? [];
  const name = readLiteral(checker, argument);
  return typeof name === "string" && name.length > 0 ? name : null;
};

const indexDeclarations = (
  program: ts.Program,
  checker: ts.TypeChecker,
  diagnostics: ExtractionDiagnostic[],
): Map<string, SupportedDeclaration> => {
  const declarations = new Map<string, SupportedDeclaration>();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) {
      continue;
    }

    for (const statement of sourceFile.statements) {
      if (
        !ts.isEnumDeclaration(statement) &&
        !ts.isInterfaceDeclaration(statement) &&
        !ts.isTypeAliasDeclaration(statement)
      ) {
        continue;
      }

      if (!hasModifier(statement, ts.ModifierFlags.Export)) {
        continue;
      }

      if (ts.isInterfaceDeclaration(statement) && isContractInterface(statement, checker)) {
        continue;
      }

      const existing = declarations.get(statement.name.text);
      if (existing) {
        diagnostics.push(
          createNodeDiagnostic(
            statement.name,
            "DUPLICATE_TYPE_NAME",
            `Multiple exported declarations named "${statement.name.text}" are not supported.`,
          ),
        );
        continue;
      }

      declarations.set(statement.name.text, statement);
    }
  }

  return declarations;
};

const collectTypeReferences = (type: RivetType, references: Set<string>): void => {
  switch (type.kind) {
    case "array":
      collectTypeReferences(type.element, references);
      return;
    case "brand":
      collectTypeReferences(type.underlying, references);
      return;
    case "dictionary":
      collectTypeReferences(type.value, references);
      return;
    case "generic":
      references.add(type.name);
      for (const typeArg of type.typeArgs) {
        collectTypeReferences(typeArg, references);
      }
      return;
    case "inlineObject":
      for (const property of type.properties) {
        collectTypeReferences(property.type, references);
      }
      return;
    case "taggedUnion":
      for (const variant of type.variants) {
        collectTypeReferences(variant.type, references);
      }
      return;
    case "union":
      for (const variant of type.variants) {
        collectTypeReferences(variant, references);
      }
      return;
    case "nullable":
      collectTypeReferences(type.inner, references);
      return;
    case "ref":
      references.add(type.name);
      return;
    case "intUnion":
    case "literal":
    case "primitive":
    case "stringUnion":
    case "typeParam":
      return;
  }
};

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
  const referencedTypeNames = new Set<string>();
  const emissionContext = new TypeEmissionContext(checker, declarations, diagnostics);
  const contracts = emissionContext.discoverContracts(sourceFile);

  for (const contract of contracts) {
    for (const endpoint of contract.endpoints) {
      const loweredEndpoint = emissionContext.lowerEndpoint(endpoint);
      endpoints.push(loweredEndpoint);
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

    const lowered = emissionContext.lowerNamedDeclaration(name);
    if (!lowered) {
      continue;
    }

    if (lowered.kind === "enum") {
      enums.set(name, lowered.value);
    } else {
      typeDefinitions.set(name, lowered.value);
    }

    for (const reference of lowered.references) {
      if (typeDefinitions.has(reference) || enums.has(reference) || queued.has(reference)) {
        continue;
      }

      queue.push(reference);
      queued.add(reference);
    }
  }

  const document = new RivetContractDocument({
    types: [...typeDefinitions.values()].sort((left, right) => left.name.localeCompare(right.name)),
    enums: [...enums.values()].sort((left, right) => left.name.localeCompare(right.name)),
    endpoints,
  });

  return new RivetContractLoweringResult({
    document,
    diagnostics,
    contracts: contracts.map(toDiscoveredContract),
  });
};

const toDiscoveredContract = (contract: DiscoveredContractSpec): DiscoveredContract => ({
  name: contract.name,
  exportedName: contract.exportedName,
  sourceFilePath: contract.sourceFilePath,
  endpoints: contract.endpoints.map((endpoint) => ({
    name: endpoint.name,
    method: endpoint.method,
    route: endpoint.route,
    hasInput: endpoint.hasInput,
    hasParams: endpoint.hasParams,
    hasQuery: endpoint.hasQuery,
  })),
});

class TypeEmissionContext {
  private readonly checker: ts.TypeChecker;
  private readonly declarations: Map<string, SupportedDeclaration>;
  private readonly diagnostics: ExtractionDiagnostic[];

  public constructor(
    checker: ts.TypeChecker,
    declarations: Map<string, SupportedDeclaration>,
    diagnostics: ExtractionDiagnostic[],
  ) {
    this.checker = checker;
    this.declarations = declarations;
    this.diagnostics = diagnostics;
  }

  // ------------------------------------------------------------------
  // Contract discovery (absorbed from the deleted TypeScript contract
  // frontend). X6/X23: an interface that opted into the Contract DSL must
  // either yield a usable contract or fail loudly — never vanish silently.
  // ------------------------------------------------------------------

  public discoverContracts(sourceFile: ts.SourceFile): DiscoveredContractSpec[] {
    const contracts: DiscoveredContractSpec[] = [];

    for (const statement of sourceFile.statements) {
      if (!ts.isInterfaceDeclaration(statement)) {
        continue;
      }

      const contractHeritage = getContractHeritageType(statement, this.checker);
      if (!contractHeritage) {
        continue;
      }

      const contractName = getContractName(statement, this.checker);
      if (contractName === null) {
        this.diagnostics.push(
          createNodeDiagnostic(
            contractHeritage,
            "INVALID_CONTRACT_NAME",
            `Interface "${statement.name.text}" must declare Contract<"Name"> with a non-empty string literal name.`,
          ),
        );
        continue;
      }

      const endpoints: DiscoveredEndpointSpec[] = [];
      for (const member of statement.members) {
        if (!ts.isPropertySignature(member) || !member.type || !member.name) {
          continue;
        }

        const endpointName = this.getEndpointMemberName(member.name);
        if (!endpointName) {
          this.diagnostics.push(
            createNodeDiagnostic(
              member,
              "UNSUPPORTED_ENDPOINT_NAME",
              "Only identifier endpoint names are supported.",
            ),
          );
          continue;
        }

        const endpoint = this.discoverEndpoint(member.type, endpointName, contractName);
        if (endpoint) {
          endpoints.push(endpoint);
        }
      }

      contracts.push({
        name: contractName,
        exportedName: statement.name.text,
        sourceFilePath: sourceFile.fileName,
        endpoints,
      });
    }

    return contracts;
  }

  private getEndpointMemberName(name: ts.PropertyName): string | null {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
      return name.text;
    }

    return null;
  }

  private discoverEndpoint(
    typeNode: ts.TypeNode,
    endpointName: string,
    contractName: string,
  ): DiscoveredEndpointSpec | null {
    if (
      !ts.isTypeReferenceNode(typeNode) ||
      !isRivetSymbol(this.checker, typeNode.typeName, "Endpoint")
    ) {
      this.diagnostics.push(
        createNodeDiagnostic(
          typeNode,
          "UNSUPPORTED_ENDPOINT_TYPE",
          `Endpoint "${endpointName}" must use Endpoint<{ ... }>.`,
        ),
      );
      return null;
    }

    const [specNode] = typeNode.typeArguments ?? [];
    if (!specNode) {
      this.diagnostics.push(
        createNodeDiagnostic(
          typeNode,
          "INVALID_ENDPOINT_SPEC",
          `Endpoint "${endpointName}" must declare an endpoint authoring spec.`,
        ),
      );
      return null;
    }

    // X2: generic spec aliases (Endpoint<CrudSpec<T>>) would lower the
    // declaration's unsubstituted type parameters; reject them loudly until
    // the pipeline can instantiate type arguments.
    if (ts.isTypeReferenceNode(specNode) && (specNode.typeArguments?.length ?? 0) > 0) {
      this.diagnostics.push(
        createNodeDiagnostic(
          specNode,
          "UNSUPPORTED_GENERIC_ENDPOINT_SPEC",
          `Endpoint "${endpointName}" uses a generic endpoint spec alias; generic spec aliases are not supported. Inline the spec or use a non-generic alias.`,
        ),
      );
      return null;
    }

    const propertyMap = this.createPropertyMap(specNode);
    if (!propertyMap) {
      this.diagnostics.push(
        createNodeDiagnostic(
          typeNode,
          "INVALID_ENDPOINT_SPEC",
          `Endpoint "${endpointName}" must use a type literal spec or a type alias that resolves to one.`,
        ),
      );
      return null;
    }

    const method = this.parseHttpMethod(propertyMap.get("method"), endpointName);
    const route = this.readStringLiteral(propertyMap.get("route"));

    if (!method || !route) {
      this.diagnostics.push(
        createNodeDiagnostic(
          specNode,
          "INCOMPLETE_ENDPOINT",
          `Endpoint "${endpointName}" must declare both method and route.`,
        ),
      );
      return null;
    }

    const successStatus = this.readNumericLiteral(propertyMap.get("successStatus"));
    const formEncoded = this.readBooleanLiteral(propertyMap.get("formEncoded")) ?? false;
    const acceptsFile = this.readBooleanLiteral(propertyMap.get("acceptsFile")) ?? false;
    const fileContentType =
      this.readBooleanLiteral(propertyMap.get("fileResponse")) === true
        ? (this.readStringLiteral(propertyMap.get("fileContentType")) ?? "application/octet-stream")
        : undefined;
    const requestMediaType = acceptsFile
      ? "multipart/form-data"
      : formEncoded
        ? "application/x-www-form-urlencoded"
        : JSON_MEDIA_TYPE;

    return {
      contractName,
      name: endpointName,
      specNode,
      propertyMap,
      method,
      route,
      successStatus,
      formEncoded,
      acceptsFile,
      hasInput: propertyMap.has("input"),
      hasParams: propertyMap.has("params"),
      hasQuery: propertyMap.has("query"),
      fileContentType,
      requestExamples: this.parseRequestExamples(propertyMap, endpointName, requestMediaType),
      responseExamples: this.parseResponseExamples(
        propertyMap,
        endpointName,
        method,
        successStatus,
        fileContentType,
      ),
    };
  }

  private parseHttpMethod(node: ts.TypeNode | undefined, endpointName: string): HttpMethod | null {
    const method = this.readStringLiteral(node);
    if (!method) {
      return null;
    }

    if (!HTTP_METHODS.has(method as HttpMethod)) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node!,
          "UNSUPPORTED_HTTP_METHOD",
          `Endpoint "${endpointName}" uses unsupported HTTP method "${method}".`,
        ),
      );
      return null;
    }

    return method as HttpMethod;
  }

  private parseRequestExamples(
    propertyMap: ReadonlyMap<string, ts.TypeNode>,
    endpointName: string,
    defaultMediaType: string,
  ): RivetExample[] {
    const pluralNode = propertyMap.get("requestExamples");
    const singularNode = propertyMap.get("requestExample");
    const target: ExampleTarget = { typeNode: propertyMap.get("input"), property: "input" };

    if (pluralNode && singularNode) {
      this.diagnostics.push(
        createNodeDiagnostic(
          pluralNode,
          "CONFLICTING_REQUEST_EXAMPLE_SPEC",
          `Endpoint "${endpointName}" cannot declare both requestExample and requestExamples.`,
        ),
      );
      return [];
    }

    if (pluralNode) {
      const entryNodes = this.getListEntryNodes(pluralNode);
      if (!entryNodes) {
        this.diagnostics.push(
          createNodeDiagnostic(
            pluralNode,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" must declare requestExamples as an array of typeof exportedConst entries or { json: typeof exportedConst } descriptors.`,
          ),
        );
        return [];
      }

      const context = { endpointName, label: "requestExamples entries", defaultMediaType, target };
      return entryNodes.flatMap((entryNode) => this.parseExampleEntry(entryNode, context) ?? []);
    }

    if (!singularNode) {
      return [];
    }

    const json = this.readExportedConstExample(singularNode, {
      endpointName,
      label: "requestExample",
      target,
    });
    return json === null ? [] : [new RivetExample({ mediaType: defaultMediaType, json })];
  }

  private parseResponseExamples(
    propertyMap: ReadonlyMap<string, ts.TypeNode>,
    endpointName: string,
    method: HttpMethod,
    successStatus: number | null,
    fileContentType: string | undefined,
  ): ResponseExampleGroup[] {
    const pluralNode = propertyMap.get("responseExamples");
    const singularNode = propertyMap.get("successResponseExample");
    const responseNode = propertyMap.get("response");

    if (pluralNode && singularNode) {
      this.diagnostics.push(
        createNodeDiagnostic(
          pluralNode,
          "CONFLICTING_RESPONSE_EXAMPLE_SPEC",
          `Endpoint "${endpointName}" cannot declare both successResponseExample and responseExamples.`,
        ),
      );
      return [];
    }

    if (pluralNode) {
      const entryNodes = this.getListEntryNodes(pluralNode);
      if (!entryNodes) {
        this.diagnostics.push(
          createNodeDiagnostic(
            pluralNode,
            "INVALID_RESPONSE_EXAMPLES_SPEC",
            `Endpoint "${endpointName}" must declare responseExamples as an array of { status; examples } entries.`,
          ),
        );
        return [];
      }

      return entryNodes.flatMap(
        (entryNode) =>
          this.parseResponseExampleGroup(entryNode, endpointName, fileContentType) ?? [],
      );
    }

    if (!singularNode) {
      return [];
    }

    const json = this.readExportedConstExample(singularNode, {
      endpointName,
      label: "successResponseExample",
      target: { typeNode: responseNode, property: "response" },
    });
    if (json === null) {
      return [];
    }

    const status =
      successStatus ??
      this.getDefaultSuccessStatus(
        method,
        responseNode !== undefined && responseNode.kind !== ts.SyntaxKind.VoidKeyword,
      );
    const mediaType = getResponseExampleMediaType(status, fileContentType);
    return [{ status, examples: [new RivetExample({ mediaType, json })], node: singularNode }];
  }

  // Status-scoped response examples are deliberately not type-checked: the
  // DSL does not constrain them and C# Rivet carries example JSON verbatim.
  private parseResponseExampleGroup(
    node: ts.TypeNode,
    endpointName: string,
    fileContentType: string | undefined,
  ): ResponseExampleGroup | null {
    const propertyMap = this.createPropertyMap(node);
    if (!propertyMap) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_RESPONSE_EXAMPLES_ENTRY",
          `Endpoint "${endpointName}" responseExamples entries must be { status; examples } objects.`,
        ),
      );
      return null;
    }

    const status = this.readNumericLiteral(propertyMap.get("status"));
    if (status === null) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "MISSING_RESPONSE_EXAMPLE_STATUS",
          `Endpoint "${endpointName}" responseExamples entry must declare a numeric status.`,
        ),
      );
      return null;
    }

    const examplesNode = propertyMap.get("examples");
    if (!examplesNode) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "MISSING_RESPONSE_EXAMPLES",
          `Endpoint "${endpointName}" responseExamples entry for status ${status} must declare an examples array.`,
        ),
      );
      return null;
    }

    const entryNodes = this.getListEntryNodes(examplesNode);
    if (!entryNodes) {
      this.diagnostics.push(
        createNodeDiagnostic(
          examplesNode,
          "INVALID_RESPONSE_EXAMPLES",
          `Endpoint "${endpointName}" responseExamples entry for status ${status} must declare examples as an array of typeof exportedConst entries.`,
        ),
      );
      return null;
    }

    const context = {
      endpointName,
      label: `responseExamples[${status}].examples entries`,
      defaultMediaType: getResponseExampleMediaType(status, fileContentType),
    };
    return {
      status,
      examples: entryNodes.flatMap((entryNode) => this.parseExampleEntry(entryNode, context) ?? []),
      node,
    };
  }

  /** One entry of an example list: `typeof exportedConst`, `{ json }` or `{ componentExampleId; resolvedJson }`. */
  private parseExampleEntry(
    node: ts.TypeNode,
    context: ExampleReadContext & { readonly defaultMediaType: string },
  ): RivetExample | null {
    const { endpointName, label } = context;
    if (ts.isTypeQueryNode(node)) {
      const json = this.readExportedConstExample(node, context);
      return json === null ? null : new RivetExample({ mediaType: context.defaultMediaType, json });
    }

    const propertyMap = this.createPropertyMap(node);
    if (!propertyMap) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" ${label} must be typeof exportedConst or a supported descriptor object.`,
        ),
      );
      return null;
    }

    const name = this.readExampleDescriptorString(propertyMap.get("name"), "name", context);
    const mediaType = this.readExampleDescriptorString(
      propertyMap.get("mediaType"),
      "mediaType",
      context,
    );
    if (name === null || mediaType === null) {
      return null;
    }

    const jsonNode = propertyMap.get("json");
    const componentExampleIdNode = propertyMap.get("componentExampleId");
    const resolvedJsonNode = propertyMap.get("resolvedJson");
    const exampleMediaType = mediaType ?? context.defaultMediaType;

    if (jsonNode) {
      if (componentExampleIdNode || resolvedJsonNode) {
        this.diagnostics.push(
          createNodeDiagnostic(
            node,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" ${label} must use either inline json or ref-backed componentExampleId/resolvedJson fields, not both.`,
          ),
        );
        return null;
      }

      const json = this.readExportedConstExample(jsonNode, { ...context, label: `${label}.json` });
      return json === null ? null : new RivetExample({ mediaType: exampleMediaType, json, name });
    }

    if (componentExampleIdNode || resolvedJsonNode) {
      if (!componentExampleIdNode || !resolvedJsonNode) {
        this.diagnostics.push(
          createNodeDiagnostic(
            node,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" ref-backed ${label} must declare both componentExampleId and resolvedJson.`,
          ),
        );
        return null;
      }

      const componentExampleId = this.readStringLiteral(componentExampleIdNode);
      if (!componentExampleId) {
        this.diagnostics.push(
          createNodeDiagnostic(
            componentExampleIdNode,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" ${label} must declare componentExampleId as a string literal.`,
          ),
        );
        return null;
      }

      const resolvedJson = this.readExportedConstExample(resolvedJsonNode, {
        ...context,
        label: `${label}.resolvedJson`,
      });
      return resolvedJson === null
        ? null
        : new RivetExample({ mediaType: exampleMediaType, componentExampleId, resolvedJson, name });
    }

    this.diagnostics.push(
      createNodeDiagnostic(
        node,
        "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
        `Endpoint "${endpointName}" ${label} must be typeof exportedConst, { json: typeof exportedConst }, or { componentExampleId: "..."; resolvedJson: typeof exportedConst }.`,
      ),
    );
    return null;
  }

  /**
   * Reads `typeof exportedConst` as JSON-like example data. With a target the
   * const's type must be assignable to the endpoint's input/response type.
   */
  private readExportedConstExample(
    node: ts.TypeNode,
    context: ExampleReadContext,
  ): RivetEndpointExampleValue | null {
    const { endpointName, label, target } = context;
    if (!ts.isTypeQueryNode(node)) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" must declare ${label} as typeof exportedConst.`,
        ),
      );
      return null;
    }

    const declaration = this.resolveExampleDeclaration(node.exprName);
    if (
      !declaration ||
      !declaration.initializer ||
      (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) === 0 ||
      !hasModifier(declaration, ts.ModifierFlags.Export)
    ) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" must declare ${label} as typeof an exported const with an initializer.`,
        ),
      );
      return null;
    }

    if (target && !target.typeNode) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ENDPOINT_EXAMPLE_TYPE",
          `Endpoint "${endpointName}" ${label} requires the corresponding endpoint ${target.property} type.`,
        ),
      );
      return null;
    }

    const data = this.parseExampleValue(declaration.initializer);
    if (data === undefined) {
      this.diagnostics.push(
        createNodeDiagnostic(
          declaration.initializer,
          "UNSUPPORTED_ENDPOINT_EXAMPLE_VALUE",
          `Endpoint "${endpointName}" ${label} must resolve to a JSON-like const initializer.`,
        ),
      );
      return null;
    }

    if (
      target?.typeNode &&
      !this.checker.isTypeAssignableTo(
        this.checker.getTypeFromTypeNode(node),
        this.checker.getTypeFromTypeNode(target.typeNode),
      )
    ) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ENDPOINT_EXAMPLE_TYPE",
          `Endpoint "${endpointName}" ${label} must be assignable to the endpoint ${target.property} type.`,
        ),
      );
      return null;
    }

    return data;
  }

  /** `undefined` when absent, `null` when present but not a string literal (diagnosed). */
  private readExampleDescriptorString(
    node: ts.TypeNode | undefined,
    propertyName: "name" | "mediaType",
    context: ExampleReadContext,
  ): string | null | undefined {
    if (!node) {
      return undefined;
    }

    const value = this.readStringLiteral(node);
    if (value !== null) {
      return value;
    }

    this.diagnostics.push(
      createNodeDiagnostic(
        node,
        "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
        `Endpoint "${context.endpointName}" ${context.label} must declare ${propertyName} as a string literal when provided.`,
      ),
    );
    return null;
  }

  /** Elements of an authored list: `T[]`, `[A, B]`, `Array<T>`/`ReadonlyArray<T>`, or an alias of one. */
  private getListEntryNodes(node: ts.TypeNode): ts.TypeNode[] | null {
    if (ts.isParenthesizedTypeNode(node)) {
      return this.getListEntryNodes(node.type);
    }

    if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
      return this.getListEntryNodes(node.type);
    }

    if (ts.isTupleTypeNode(node)) {
      return [...node.elements];
    }

    if (ts.isArrayTypeNode(node)) {
      return [node.elementType];
    }

    if (ts.isTypeReferenceNode(node) && isListTypeName(this.libraryTypeName(node.typeName))) {
      const [elementType] = node.typeArguments ?? [];
      return elementType ? [elementType] : null;
    }

    const resolvedNode = this.resolveAliasedTypeNode(node);
    return resolvedNode ? this.getListEntryNodes(resolvedNode) : null;
  }

  private resolveExampleDeclaration(entityName: ts.EntityName): ts.VariableDeclaration | null {
    for (const declaration of resolveSymbol(this.checker, entityName)?.getDeclarations() ?? []) {
      if (ts.isVariableDeclaration(declaration)) {
        return declaration;
      }
    }

    return null;
  }

  private parseExampleValue(expression: ts.Expression): RivetEndpointExampleValue | undefined {
    const unwrapped = this.unwrapExampleExpression(expression);

    if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
      return unwrapped.text;
    }

    if (ts.isNumericLiteral(unwrapped)) {
      return Number(unwrapped.text);
    }

    if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) {
      return true;
    }

    if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) {
      return false;
    }

    if (unwrapped.kind === ts.SyntaxKind.NullKeyword) {
      return null;
    }

    if (ts.isPrefixUnaryExpression(unwrapped)) {
      const operand = this.parseExampleValue(unwrapped.operand);
      if (typeof operand !== "number") {
        return undefined;
      }

      if (unwrapped.operator === ts.SyntaxKind.MinusToken) {
        return -operand;
      }

      if (unwrapped.operator === ts.SyntaxKind.PlusToken) {
        return operand;
      }

      return undefined;
    }

    if (ts.isArrayLiteralExpression(unwrapped)) {
      const values: RivetEndpointExampleValue[] = [];
      for (const element of unwrapped.elements) {
        if (ts.isSpreadElement(element)) {
          return undefined;
        }

        const value = this.parseExampleValue(element);
        if (value === undefined) {
          return undefined;
        }

        values.push(value);
      }

      return values;
    }

    if (ts.isObjectLiteralExpression(unwrapped)) {
      const value: Record<string, RivetEndpointExampleValue> = {};
      for (const property of unwrapped.properties) {
        const entry = this.parseExampleObjectProperty(property);
        if (!entry) {
          return undefined;
        }

        value[entry.name] = entry.value;
      }

      return value;
    }

    if (ts.isIdentifier(unwrapped)) {
      return this.resolveIdentifierExampleValue(unwrapped);
    }

    if (
      ts.isBinaryExpression(unwrapped) &&
      unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = this.parseExampleValue(unwrapped.left);
      const right = this.parseExampleValue(unwrapped.right);
      if (typeof left === "string" && typeof right === "string") {
        return left + right;
      }

      return undefined;
    }

    return literalValueOfType(this.checker, this.checker.getTypeAtLocation(unwrapped)) ?? undefined;
  }

  private resolveIdentifierExampleValue(
    identifier: ts.Identifier,
  ): RivetEndpointExampleValue | undefined {
    for (const declaration of resolveSymbol(this.checker, identifier)?.getDeclarations() ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return this.parseExampleValue(declaration.initializer);
      }
    }

    return undefined;
  }

  private parseExampleObjectProperty(
    property: ts.ObjectLiteralElementLike,
  ): { name: string; value: RivetEndpointExampleValue } | null {
    if (ts.isPropertyAssignment(property)) {
      const propertyName = getPropertyName(property.name);
      if (!propertyName) {
        return null;
      }

      const propertyValue = this.parseExampleValue(property.initializer);
      return propertyValue === undefined ? null : { name: propertyName, value: propertyValue };
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      const propertyValue = this.parseShorthandExampleValue(property);
      return propertyValue === undefined
        ? null
        : { name: property.name.text, value: propertyValue };
    }

    return null;
  }

  private parseShorthandExampleValue(
    property: ts.ShorthandPropertyAssignment,
  ): RivetEndpointExampleValue | undefined {
    const symbol = this.checker.getShorthandAssignmentValueSymbol(property);
    if (!symbol) {
      return undefined;
    }

    const resolvedSymbol = resolveAlias(this.checker, symbol);
    for (const declaration of resolvedSymbol.getDeclarations() ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return this.parseExampleValue(declaration.initializer);
      }
    }

    return (
      literalValueOfType(
        this.checker,
        this.checker.getTypeOfSymbolAtLocation(resolvedSymbol, property.name),
      ) ?? undefined
    );
  }

  private unwrapExampleExpression(expression: ts.Expression): ts.Expression {
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isTypeAssertionExpression(expression)
    ) {
      return this.unwrapExampleExpression(expression.expression);
    }

    return expression;
  }

  public lowerEndpoint(endpoint: DiscoveredEndpointSpec): RivetEndpointDefinition {
    const { propertyMap, specNode, fileContentType } = endpoint;
    const inputNode = propertyMap.get("input");
    const paramsNode = propertyMap.get("params");
    const queryNode = propertyMap.get("query");
    const summary = this.readStringLiteral(propertyMap.get("summary")) ?? undefined;
    const description = this.readStringLiteral(propertyMap.get("description")) ?? undefined;
    const anonymous = this.readBooleanLiteral(propertyMap.get("anonymous")) ?? false;
    const securityScheme = this.readSecurityScheme(propertyMap.get("security"), endpoint);
    const queryAuthBool = this.readBooleanLiteral(propertyMap.get("queryAuth"));
    const queryAuthString = this.readStringLiteral(propertyMap.get("queryAuth"));
    const queryAuth =
      queryAuthBool === true
        ? { parameterName: "token" }
        : queryAuthString
          ? { parameterName: queryAuthString }
          : undefined;
    const inputType = this.lowerOptionalTypeNode(inputNode);
    const responseType = this.lowerOptionalTypeNode(propertyMap.get("response"));

    // buildExplicitEndpointParams has no multipart handling, so explicit
    // params:/query: would bypass acceptsFile and contradict the
    // multipart/form-data request media type.
    if (endpoint.acceptsFile && (paramsNode || queryNode)) {
      this.diagnostics.push(
        createNodeDiagnostic(
          paramsNode ?? queryNode ?? specNode,
          "INVALID_MULTIPART_INPUT",
          `Endpoint "${endpoint.contractName}.${endpoint.name}" cannot combine acceptsFile with explicit params/query declarations; declare route and form fields on the input type instead.`,
        ),
      );
    }

    const params =
      paramsNode || queryNode
        ? this.buildExplicitEndpointParams(endpoint, inputType, paramsNode, queryNode)
        : this.buildEndpointParams(endpoint, inputType);
    const responses = this.mergeResponseExamples(
      this.buildResponses(endpoint, responseType),
      endpoint,
    );

    if (anonymous && securityScheme) {
      this.diagnostics.push(
        createNodeDiagnostic(
          propertyMap.get("security") ?? specNode,
          "CONFLICTING_SECURITY_SPEC",
          `Endpoint "${endpoint.contractName}.${endpoint.name}" cannot declare both anonymous and security.`,
        ),
      );
    }

    const security =
      anonymous || securityScheme
        ? new RivetEndpointSecurity({
            isAnonymous: anonymous,
            scheme: anonymous ? undefined : (securityScheme ?? undefined),
          })
        : undefined;
    const inputTypeName =
      endpoint.acceptsFile &&
      inputNode &&
      ts.isTypeReferenceNode(inputNode) &&
      !inputNode.typeArguments?.length
        ? this.resolveTypeName(inputNode.typeName)
        : undefined;

    return new RivetEndpointDefinition({
      name: toCamelCase(endpoint.name),
      httpMethod: endpoint.method,
      routeTemplate: endpoint.route,
      params,
      returnType: responseType ?? undefined,
      controllerName: deriveGroupName(endpoint.contractName),
      responses,
      summary,
      description,
      requestExamples: endpoint.requestExamples.length > 0 ? endpoint.requestExamples : undefined,
      security,
      fileContentType,
      inputTypeName,
      isFormEncoded: endpoint.formEncoded || undefined,
      queryAuth,
    });
  }

  public lowerNamedDeclaration(name: string):
    | {
        kind: "enum";
        value: RivetContractEnum;
        references: readonly string[];
      }
    | {
        kind: "type";
        value: RivetTypeDefinition;
        references: readonly string[];
      }
    | null {
    const declaration = this.declarations.get(name);
    if (!declaration) {
      this.diagnostics.push(
        new ExtractionDiagnostic({
          severity: "error",
          code: "TYPE_NOT_FOUND",
          message: `Could not resolve referenced type "${name}".`,
        }),
      );
      return null;
    }

    if (ts.isEnumDeclaration(declaration)) {
      return this.lowerEnumDeclaration(declaration);
    }

    if (ts.isTypeAliasDeclaration(declaration)) {
      const enumLikeAlias = this.lowerEnumLikeTypeAlias(declaration);
      if (enumLikeAlias) {
        return {
          kind: "enum",
          value: enumLikeAlias,
          references: [],
        };
      }
    }

    const typeDefinition = this.lowerTypeDefinition(declaration);
    if (!typeDefinition) {
      return null;
    }

    const references = new Set<string>();
    if (typeDefinition.type) {
      collectTypeReferences(typeDefinition.type, references);
    } else {
      for (const property of typeDefinition.properties) {
        collectTypeReferences(property.type, references);
      }
    }
    references.delete(typeDefinition.name);

    return {
      kind: "type",
      value: typeDefinition,
      references: [...references].sort(),
    };
  }

  private lowerEnumDeclaration(declaration: ts.EnumDeclaration): {
    kind: "enum";
    value: RivetContractEnum;
    references: readonly string[];
  } | null {
    const stringValues: string[] = [];
    const intValues: number[] = [];
    for (const member of declaration.members) {
      const value = this.checker.getConstantValue(member);
      if (value === undefined) {
        this.diagnostics.push(
          createNodeDiagnostic(
            member,
            "UNSUPPORTED_ENUM_MEMBER",
            `Enum "${declaration.name.text}" must use members with constant string or numeric values.`,
          ),
        );
        return null;
      }

      if (typeof value === "string") {
        stringValues.push(value);
      } else {
        intValues.push(value);
      }
    }

    if (stringValues.length > 0 && intValues.length > 0) {
      this.diagnostics.push(
        createNodeDiagnostic(
          declaration.name,
          "MIXED_ENUM_TYPES",
          `Enum "${declaration.name.text}" cannot mix string and numeric members.`,
        ),
      );
      return null;
    }

    if (stringValues.length > 0) {
      return {
        kind: "enum",
        value: {
          name: declaration.name.text,
          values: stringValues,
        },
        references: [],
      };
    }

    return {
      kind: "enum",
      value: {
        name: declaration.name.text,
        intValues,
      },
      references: [],
    };
  }

  private lowerEnumLikeTypeAlias(declaration: ts.TypeAliasDeclaration): RivetContractEnum | null {
    if (!ts.isUnionTypeNode(declaration.type)) {
      return null;
    }

    const literalUnion = this.readLiteralUnion(declaration.type.types);
    if (!literalUnion) {
      return null;
    }

    const name = declaration.name.text;
    return literalUnion.kind === "string"
      ? { name, values: literalUnion.values }
      : { name, intValues: literalUnion.values };
  }

  private lowerTypeDefinition(
    declaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
  ): RivetTypeDefinition | null {
    const name = declaration.name.text;
    const typeParameters =
      declaration.typeParameters?.map((parameter) => parameter.name.text) ?? [];
    const scope = new Set(typeParameters);

    let descriptors: PropertyDescriptor[] | null;
    if (ts.isInterfaceDeclaration(declaration)) {
      descriptors = this.readInterfaceProperties(declaration, `Type "${name}"`);
    } else if (ts.isTypeLiteralNode(declaration.type)) {
      descriptors = this.readPropertyMembers(declaration.type.members, `Type "${name}"`);
    } else {
      const type = this.lowerTypeNode(declaration.type, scope);
      return type ? new RivetTypeDefinition({ name, typeParameters, type }) : null;
    }

    const properties = descriptors && this.lowerProperties(descriptors, scope);
    return properties ? new RivetTypeDefinition({ name, typeParameters, properties }) : null;
  }

  private lowerProperties(
    descriptors: readonly PropertyDescriptor[],
    scope: Set<string>,
  ): RivetPropertyDefinition[] | null {
    const properties: RivetPropertyDefinition[] = [];
    for (const descriptor of descriptors) {
      const type = this.lowerTypeNode(descriptor.typeNode, scope);
      if (!type) {
        return null;
      }

      properties.push({
        name: descriptor.name,
        type,
        optional: descriptor.optional,
        readOnly: descriptor.readOnly || undefined,
      });
    }

    return properties;
  }

  // Inline objects carry `optional` only when it is true or the type is
  // nullable, so `x?: T`, `x: T | null` and `x?: T | null` stay distinct.
  private lowerInlineObject(
    descriptors: readonly PropertyDescriptor[],
    scope: Set<string>,
  ): RivetType | null {
    const properties = this.lowerProperties(descriptors, scope);
    return properties
      ? {
          kind: "inlineObject",
          properties: properties.map(({ name, type, optional }) => ({
            name,
            type,
            ...(optional || type.kind === "nullable" ? { optional } : {}),
          })),
        }
      : null;
  }

  private buildExplicitEndpointParams(
    endpoint: DiscoveredEndpointSpec,
    inputType: RivetType | null,
    paramsNode: ts.TypeNode | undefined,
    queryNode: ts.TypeNode | undefined,
  ): RivetEndpointParam[] {
    const params: RivetEndpointParam[] = [];
    if (paramsNode) {
      this.pushObjectParams(params, paramsNode, "route", endpoint);
    }

    this.appendRouteParams(params, endpoint.route);

    if (queryNode) {
      this.pushObjectParams(params, queryNode, "query", endpoint);
    }

    if (inputType) {
      params.push(
        new RivetEndpointParam({
          name: "body",
          type: inputType,
          source: "body",
          isOptional: false,
        }),
      );
    }

    return params;
  }

  private pushObjectParams(
    params: RivetEndpointParam[],
    node: ts.TypeNode,
    source: "route" | "query",
    endpoint: DiscoveredEndpointSpec,
  ): void {
    const properties = this.getObjectProperties(node);
    if (!properties) {
      const slot = source === "route" ? "params" : "query";
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          source === "route" ? "UNSUPPORTED_PARAMS_SHAPE" : "UNSUPPORTED_QUERY_SHAPE",
          `Endpoint "${endpoint.contractName}.${endpoint.name}" must declare ${slot} as an object literal type or an interface/alias of property signatures.`,
        ),
      );
      return;
    }

    const scope = this.getTypeParameterScope(node);
    for (const property of properties) {
      const type = this.lowerTypeNode(property.typeNode, scope);
      if (type) {
        params.push(
          new RivetEndpointParam({
            name: property.name,
            type,
            source,
            isOptional: property.optional,
          }),
        );
      }
    }
  }

  /**
   * Adds a route param for every `{placeholder}` no route param covers yet,
   * typed from `typesByLowerName` when the input declares it, else string.
   */
  private appendRouteParams(
    params: RivetEndpointParam[],
    route: string,
    typesByLowerName: ReadonlyMap<string, RivetType> = new Map(),
  ): void {
    const covered = new Set(
      params.filter((param) => param.source === "route").map((param) => param.name.toLowerCase()),
    );
    for (const routeParamName of parseRouteParamNames(route)) {
      const key = routeParamName.toLowerCase();
      if (!covered.has(key)) {
        params.push(
          new RivetEndpointParam({
            name: routeParamName,
            type: typesByLowerName.get(key) ?? { kind: "primitive", type: "string" },
            source: "route",
            isOptional: false,
          }),
        );
      }
    }
  }

  private buildEndpointParams(
    endpoint: DiscoveredEndpointSpec,
    inputType: RivetType | null,
  ): RivetEndpointParam[] {
    const inputNode = endpoint.propertyMap.get("input");
    const params: RivetEndpointParam[] = [];

    if (BODY_HTTP_METHODS.has(endpoint.method)) {
      if (endpoint.acceptsFile && inputNode) {
        return this.buildMultipartParams(endpoint, inputNode);
      }

      this.appendRouteParams(
        params,
        endpoint.route,
        inputNode ? this.getNamedPropertyTypes(inputNode) : undefined,
      );
      if (inputType) {
        params.push(
          new RivetEndpointParam({
            name: "body",
            type: inputType,
            source: "body",
            isOptional: false,
          }),
        );
      }

      return params;
    }

    if (!inputNode) {
      this.appendRouteParams(params, endpoint.route);
      return params;
    }

    const objectProperties = this.getObjectProperties(inputNode);
    if (!objectProperties) {
      this.diagnostics.push(
        createNodeDiagnostic(
          inputNode,
          "UNSUPPORTED_INPUT_SHAPE",
          `Endpoint "${endpoint.contractName}.${endpoint.name}" must use an object-like input type for ${endpoint.method} parameters.`,
        ),
      );
      return params;
    }

    const routeParamNames = new Set(
      parseRouteParamNames(endpoint.route).map((name) => name.toLowerCase()),
    );
    const scope = this.getTypeParameterScope(inputNode);
    for (const property of objectProperties) {
      const propertyType = this.lowerTypeNode(property.typeNode, scope);
      if (!propertyType) {
        continue;
      }

      params.push(
        new RivetEndpointParam({
          name: property.name,
          type: propertyType,
          source: routeParamNames.has(property.name.toLowerCase()) ? "route" : "query",
          isOptional: property.optional,
        }),
      );
    }

    this.appendRouteParams(params, endpoint.route);
    return params;
  }

  private buildMultipartParams(
    endpoint: DiscoveredEndpointSpec,
    inputNode: ts.TypeNode,
  ): RivetEndpointParam[] {
    const objectProperties = this.getObjectProperties(inputNode);
    if (!objectProperties) {
      this.diagnostics.push(
        createNodeDiagnostic(
          inputNode,
          "INVALID_MULTIPART_INPUT",
          `Endpoint "${endpoint.contractName}.${endpoint.name}" must use an object-like input type for multipart parameters.`,
        ),
      );
      return [];
    }

    const routeParamNamesLower = new Set(
      parseRouteParamNames(endpoint.route).map((name) => name.toLowerCase()),
    );
    const params: RivetEndpointParam[] = [];
    const typeParameterScope = this.getTypeParameterScope(inputNode);
    let fileProperty: PropertyDescriptor | null = null;
    const formFieldProperties: PropertyDescriptor[] = [];

    for (const property of objectProperties) {
      if (routeParamNamesLower.has(property.name.toLowerCase())) {
        const propertyType = this.lowerTypeNode(property.typeNode, typeParameterScope);
        params.push(
          new RivetEndpointParam({
            name: property.name,
            type: propertyType ?? { kind: "primitive", type: "string" },
            source: "route",
            isOptional: property.optional,
          }),
        );
        continue;
      }

      if (this.isFileTypeNode(property.typeNode)) {
        if (fileProperty) {
          this.diagnostics.push(
            createNodeDiagnostic(
              inputNode,
              "INVALID_MULTIPART_INPUT",
              `Endpoint "${endpoint.contractName}.${endpoint.name}" must have exactly one Blob or File property for multipart upload, but found multiple.`,
            ),
          );
          return params;
        }
        fileProperty = property;
      } else {
        formFieldProperties.push(property);
      }
    }

    if (!fileProperty) {
      this.diagnostics.push(
        createNodeDiagnostic(
          inputNode,
          "INVALID_MULTIPART_INPUT",
          `Endpoint "${endpoint.contractName}.${endpoint.name}" must have exactly one Blob or File property for multipart upload, but found none.`,
        ),
      );
      return params;
    }

    params.push(
      new RivetEndpointParam({
        name: fileProperty.name,
        type: { kind: "primitive", type: "File" },
        source: "file",
        isOptional: fileProperty.optional,
      }),
    );

    for (const property of formFieldProperties) {
      const propertyType = this.lowerTypeNode(property.typeNode, typeParameterScope);
      if (!propertyType) {
        continue;
      }

      params.push(
        new RivetEndpointParam({
          name: property.name,
          type: propertyType,
          source: "formField",
          isOptional: property.optional,
        }),
      );
    }

    return params;
  }

  private isFileTypeNode(typeNode: ts.TypeNode): boolean {
    if (!ts.isTypeReferenceNode(typeNode)) {
      return false;
    }

    const name = this.libraryTypeName(typeNode.typeName);
    return name === "Blob" || name === "File";
  }

  private getNamedPropertyTypes(inputNode: ts.TypeNode): Map<string, RivetType> {
    const properties = this.getObjectProperties(inputNode);
    const propertyTypes = new Map<string, RivetType>();

    if (!properties) {
      return propertyTypes;
    }

    for (const property of properties) {
      const loweredType = this.lowerTypeNode(
        property.typeNode,
        this.getTypeParameterScope(inputNode),
      );
      if (!loweredType) {
        continue;
      }

      propertyTypes.set(property.name.toLowerCase(), loweredType);
    }

    return propertyTypes;
  }

  private buildResponses(
    endpoint: DiscoveredEndpointSpec,
    responseType: RivetType | null,
  ): RivetResponseType[] {
    const responses: RivetResponseType[] = [];
    const responseNode = endpoint.propertyMap.get("response");
    const errorsNode = endpoint.propertyMap.get("errors");
    const errorResponses = errorsNode ? this.readErrorResponses(errorsNode, endpoint) : [];
    const fileResponse = endpoint.fileContentType !== undefined;
    const successStatusOverride = endpoint.successStatus;
    const hasResponseBody = responseType !== null || fileResponse;
    const defaultSuccessStatus = this.getDefaultSuccessStatus(endpoint.method, hasResponseBody);

    if (responseType) {
      responses.push(
        new RivetResponseType({
          statusCode: successStatusOverride ?? defaultSuccessStatus,
          dataType: responseType,
        }),
      );
    } else if (
      fileResponse ||
      successStatusOverride !== null ||
      errorResponses.length > 0 ||
      defaultSuccessStatus !== 200 ||
      (responseNode !== undefined && responseNode.kind !== ts.SyntaxKind.VoidKeyword)
    ) {
      responses.push(
        new RivetResponseType({
          statusCode: successStatusOverride ?? defaultSuccessStatus,
        }),
      );
    }

    responses.push(...errorResponses);
    responses.sort((left, right) => left.statusCode - right.statusCode);
    return responses;
  }

  private mergeResponseExamples(
    responses: RivetResponseType[],
    endpoint: DiscoveredEndpointSpec,
  ): RivetResponseType[] {
    if (endpoint.responseExamples.length === 0) {
      return responses;
    }

    const responsesByStatus = new Map<number, number>();
    for (let i = 0; i < responses.length; i++) {
      responsesByStatus.set(responses[i]!.statusCode, i);
    }

    const merged = [...responses];
    for (const group of endpoint.responseExamples) {
      if (group.examples.length > 0 && isBodyForbiddenStatus(group.status)) {
        this.diagnostics.push(
          createNodeDiagnostic(
            group.node,
            "BODY_FORBIDDEN_STATUS_EXAMPLE",
            `Endpoint "${endpoint.contractName}.${endpoint.name}" authors response content on body-forbidden status ${group.status} — HTTP forbids a message body on 1xx/204/205/304, so the authored example/content could never reach the wire; move it to a status that allows a body or remove it.`,
          ),
        );
        continue;
      }

      const index = responsesByStatus.get(group.status);
      if (index === undefined) {
        this.diagnostics.push(
          new ExtractionDiagnostic({
            severity: "error",
            code: "UNRESOLVED_RESPONSE_EXAMPLE_STATUS",
            message: `Endpoint "${endpoint.contractName}.${endpoint.name}" declares response examples for status ${group.status}, but no matching response exists.`,
          }),
        );
        continue;
      }

      const existing = merged[index]!;
      const { examples } = group;
      if (examples.length > 0) {
        merged[index] = new RivetResponseType({
          statusCode: existing.statusCode,
          dataType: existing.dataType,
          description: existing.description,
          examples,
        });
      }
    }

    return merged;
  }

  private readErrorResponses(
    node: ts.TypeNode,
    endpoint: DiscoveredEndpointSpec,
  ): RivetResponseType[] {
    const errorEntries = this.getListEntryNodes(node);
    if (!errorEntries) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ERRORS_SPEC",
          `Endpoint "${endpoint.contractName}.${endpoint.name}" must declare errors as an array or tuple type.`,
        ),
      );
      return [];
    }

    const responses: RivetResponseType[] = [];
    for (const element of errorEntries) {
      const propertyMap = this.createPropertyMap(element);
      if (!propertyMap) {
        this.diagnostics.push(
          createNodeDiagnostic(
            element,
            "INVALID_ERROR_ENTRY",
            `Endpoint "${endpoint.contractName}.${endpoint.name}" has an error entry that is not an object type.`,
          ),
        );
        continue;
      }

      const statusNode = propertyMap.get("status");
      const status = statusNode ? this.readNumericLiteral(statusNode) : null;
      if (status === null) {
        this.diagnostics.push(
          createNodeDiagnostic(
            element,
            "MISSING_ERROR_STATUS",
            `Endpoint "${endpoint.contractName}.${endpoint.name}" has an error entry without a numeric status.`,
          ),
        );
        continue;
      }

      const responseNode = propertyMap.get("response");
      const responseType = this.lowerOptionalTypeNode(responseNode);
      responses.push(
        new RivetResponseType({
          statusCode: status,
          dataType: responseType ?? undefined,
          description: this.readStringLiteral(propertyMap.get("description")) ?? undefined,
        }),
      );
    }

    return responses;
  }

  private createPropertyMap(typeNode: ts.TypeNode): Map<string, ts.TypeNode> | null {
    if (ts.isTypeLiteralNode(typeNode)) {
      return this.createPropertyMapFromTypeLiteral(typeNode);
    }

    const specType = this.checker.getTypeFromTypeNode(typeNode);
    if ((specType.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) === 0) {
      return null;
    }

    const sourceFile = getNodeSourceFile(typeNode);
    const propertyMap = new Map<string, ts.TypeNode>();
    for (const propertySymbol of this.checker.getApparentType(specType).getProperties()) {
      const propertyTypeNode = this.selectPropertyTypeNode(propertySymbol, sourceFile);
      if (!propertyTypeNode) {
        continue;
      }

      propertyMap.set(propertySymbol.getName(), propertyTypeNode);
    }

    return propertyMap;
  }

  private createPropertyMapFromTypeLiteral(
    typeLiteral: ts.TypeLiteralNode,
  ): Map<string, ts.TypeNode> {
    const propertyMap = new Map<string, ts.TypeNode>();
    for (const member of typeLiteral.members) {
      if (!ts.isPropertySignature(member) || !member.type || !member.name) {
        continue;
      }

      const propertyName = getPropertyName(member.name);
      if (!propertyName) {
        continue;
      }

      propertyMap.set(propertyName, member.type);
    }

    return propertyMap;
  }

  private selectPropertyTypeNode(symbol: ts.Symbol, sourceFile: ts.SourceFile): ts.TypeNode | null {
    const declarations = symbol
      .getDeclarations()
      ?.filter((declaration) => !this.isAuthoringHelperPropertyDeclaration(declaration))
      .flatMap((declaration) => {
        const typeNode = this.getPropertyTypeNode(declaration);
        return typeNode ? [{ declaration, typeNode }] : [];
      });

    if (!declarations || declarations.length === 0) {
      return null;
    }

    const inSourceFile = declarations.find(
      ({ declaration }) => declaration.getSourceFile().fileName === sourceFile.fileName,
    );

    return inSourceFile?.typeNode ?? declarations[0].typeNode;
  }

  private getPropertyTypeNode(declaration: ts.Declaration): ts.TypeNode | null {
    if (
      (ts.isPropertySignature(declaration) || ts.isPropertyDeclaration(declaration)) &&
      declaration.type
    ) {
      return declaration.type;
    }

    return null;
  }

  private isAuthoringHelperPropertyDeclaration(declaration: ts.Declaration): boolean {
    if (!ts.isPropertySignature(declaration) || !ts.isTypeLiteralNode(declaration.parent)) {
      return false;
    }

    const parent = declaration.parent.parent;
    return (
      ts.isTypeAliasDeclaration(parent) &&
      AUTHORING_HELPER_TYPE_NAMES.has(parent.name.text) &&
      isRivetAuthoringFile(parent.getSourceFile())
    );
  }

  private resolveAliasedTypeNode(node: ts.TypeNode): ts.TypeNode | null {
    if (ts.isParenthesizedTypeNode(node)) {
      return this.resolveAliasedTypeNode(node.type);
    }

    if (!ts.isTypeReferenceNode(node)) {
      return null;
    }

    const symbol = this.checker.getSymbolAtLocation(node.typeName);
    const declarations = symbol?.getDeclarations() ?? [];
    for (const declaration of declarations) {
      if (ts.isTypeAliasDeclaration(declaration)) {
        return declaration.type;
      }
    }

    return null;
  }

  // X5: interfaces with heritage clauses previously lowered only their own
  // members, silently dropping inherited properties. Flatten the inheritance
  // chain (own members override inherited ones by name) or fail loudly when
  // a base type cannot be resolved to a supported local interface.
  private readInterfaceProperties(
    declaration: ts.InterfaceDeclaration,
    contextLabel: string,
    seen: Set<ts.InterfaceDeclaration> = new Set(),
  ): PropertyDescriptor[] | null {
    if (seen.has(declaration)) {
      return [];
    }
    seen.add(declaration);

    const inherited: PropertyDescriptor[] = [];
    for (const clause of declaration.heritageClauses ?? []) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
        continue;
      }

      for (const type of clause.types) {
        const baseDeclaration = this.resolveHeritageInterface(type);
        if (!baseDeclaration || (type.typeArguments?.length ?? 0) > 0) {
          this.diagnostics.push(
            createNodeDiagnostic(
              type,
              "UNSUPPORTED_HERITAGE_CLAUSE",
              `${contextLabel} extends "${type.getText(getNodeSourceFile(type))}", which is not a supported base type. Only exported, non-generic local interfaces can be inherited.`,
            ),
          );
          return null;
        }

        const baseProperties = this.readInterfaceProperties(baseDeclaration, contextLabel, seen);
        if (!baseProperties) {
          return null;
        }

        inherited.push(...baseProperties);
      }
    }

    const ownProperties = this.readPropertyMembers(declaration.members, contextLabel);
    if (!ownProperties) {
      return null;
    }

    const overriddenNames = new Set(ownProperties.map((property) => property.name));
    const merged = new Map<string, PropertyDescriptor>();
    for (const property of inherited) {
      if (!overriddenNames.has(property.name)) {
        merged.set(property.name, property);
      }
    }

    return [...merged.values(), ...ownProperties];
  }

  private resolveHeritageInterface(
    type: ts.ExpressionWithTypeArguments,
  ): ts.InterfaceDeclaration | null {
    const name = resolveSymbol(this.checker, type.expression)?.getName();
    const declaration = name ? this.declarations.get(name) : undefined;
    return declaration && ts.isInterfaceDeclaration(declaration) ? declaration : null;
  }

  private readPropertyMembers(
    members: ts.NodeArray<ts.TypeElement>,
    contextLabel: string,
  ): PropertyDescriptor[] | null {
    const properties: PropertyDescriptor[] = [];
    for (const member of members) {
      if (!ts.isPropertySignature(member) || !member.type || !member.name) {
        this.diagnostics.push(
          createNodeDiagnostic(
            member,
            "UNSUPPORTED_OBJECT_MEMBER",
            `${contextLabel} may only contain property signatures.`,
          ),
        );
        return null;
      }

      const propertyName = getPropertyName(member.name);
      if (!propertyName) {
        this.diagnostics.push(
          createNodeDiagnostic(
            member.name,
            "UNSUPPORTED_PROPERTY_NAME",
            `${contextLabel} contains a property with an unsupported name.`,
          ),
        );
        return null;
      }

      // X10: `T | undefined` is the union spelling of an optional property;
      // record the optionality here and lower the defined member directly
      // when only one remains (lowerUnionTypeNode drops undefined otherwise).
      let typeNode = member.type;
      let optional = Boolean(member.questionToken);
      if (ts.isUnionTypeNode(typeNode)) {
        const definedMembers = typeNode.types.filter(
          (unionMember) => unionMember.kind !== ts.SyntaxKind.UndefinedKeyword,
        );
        if (definedMembers.length < typeNode.types.length) {
          optional = true;
          if (definedMembers.length === 1) {
            typeNode = definedMembers[0]!;
          }
        }
      }

      properties.push({
        name: propertyName,
        typeNode,
        optional,
        readOnly: hasModifier(member, ts.ModifierFlags.Readonly),
      });
    }

    return properties;
  }

  private getObjectProperties(inputNode: ts.TypeNode): PropertyDescriptor[] | null {
    if (ts.isTypeLiteralNode(inputNode)) {
      return this.readPropertyMembers(inputNode.members, "Inline object");
    }

    if (!ts.isTypeReferenceNode(inputNode) || inputNode.typeArguments?.length) {
      return null;
    }

    const name = this.resolveTypeName(inputNode.typeName);
    const declaration = this.declarations.get(name);
    if (!declaration) {
      return null;
    }

    if (ts.isInterfaceDeclaration(declaration)) {
      return this.readInterfaceProperties(declaration, `Type "${name}"`);
    }

    if (ts.isTypeAliasDeclaration(declaration) && ts.isTypeLiteralNode(declaration.type)) {
      return this.readPropertyMembers(declaration.type.members, `Type "${name}"`);
    }

    return null;
  }

  private getTypeParameterScope(node: ts.TypeNode): Set<string> {
    if (!ts.isTypeReferenceNode(node) || !node.typeArguments?.length) {
      return new Set<string>();
    }

    const name = this.resolveTypeName(node.typeName);
    const declaration = this.declarations.get(name);
    if (
      !declaration ||
      (!ts.isInterfaceDeclaration(declaration) && !ts.isTypeAliasDeclaration(declaration))
    ) {
      return new Set<string>();
    }

    const parameters = declaration.typeParameters?.map((parameter) => parameter.name.text) ?? [];
    return new Set(parameters);
  }

  private lowerOptionalTypeNode(node: ts.TypeNode | undefined): RivetType | null {
    if (!node || node.kind === ts.SyntaxKind.VoidKeyword) {
      return null;
    }

    return this.lowerTypeNode(node, new Set<string>());
  }

  private lowerTypeNode(node: ts.TypeNode, typeParameters: Set<string>): RivetType | null {
    if (ts.isParenthesizedTypeNode(node)) {
      return this.lowerTypeNode(node.type, typeParameters);
    }

    if (ts.isArrayTypeNode(node)) {
      const elementType = this.lowerTypeNode(node.elementType, typeParameters);
      return elementType
        ? {
            kind: "array",
            element: elementType,
          }
        : null;
    }

    if (ts.isTypeLiteralNode(node)) {
      const properties = this.readPropertyMembers(node.members, "Inline object");
      return properties && this.lowerInlineObject(properties, typeParameters);
    }

    if (ts.isTypeReferenceNode(node)) {
      return this.lowerTypeReferenceNode(node, typeParameters);
    }

    if (ts.isUnionTypeNode(node)) {
      return this.lowerUnionTypeNode(node, typeParameters);
    }

    const literal = this.readLiteralTypeNode(node);
    if (typeof literal === "string") {
      return { kind: "stringUnion", values: [literal] };
    }

    if (typeof literal === "number") {
      return { kind: "intUnion", values: [literal] };
    }

    if (typeof literal === "boolean") {
      return { kind: "literal", value: literal };
    }

    switch (node.kind) {
      case ts.SyntaxKind.BooleanKeyword:
        return {
          kind: "primitive",
          type: "boolean",
        };
      case ts.SyntaxKind.NumberKeyword:
        return {
          kind: "primitive",
          type: "number",
        };
      case ts.SyntaxKind.StringKeyword:
        return {
          kind: "primitive",
          type: "string",
        };
      case ts.SyntaxKind.UnknownKeyword:
        return {
          kind: "primitive",
          type: "unknown",
        };
      case ts.SyntaxKind.NullKeyword:
        this.diagnostics.push(
          createNodeDiagnostic(
            node,
            "UNSUPPORTED_NULL_TYPE",
            "Standalone null types are not supported. Use a nullable union such as T | null.",
          ),
        );
        return null;
    }

    this.diagnostics.push(
      createNodeDiagnostic(
        node,
        "UNSUPPORTED_TYPE_EXPRESSION",
        `Unsupported type expression "${node.getText(getNodeSourceFile(node))}".`,
      ),
    );
    return null;
  }

  private lowerTypeReferenceNode(
    node: ts.TypeReferenceNode,
    typeParameters: Set<string>,
  ): RivetType | null {
    const typeName = this.resolveTypeName(node.typeName);
    const libraryTypeName = this.libraryTypeName(node.typeName);
    const typeArguments = node.typeArguments ?? [];

    if (isListTypeName(libraryTypeName)) {
      const [elementNode] = typeArguments;
      if (!elementNode) {
        this.diagnostics.push(
          createNodeDiagnostic(
            node,
            "INVALID_ARRAY_TYPE",
            `${typeName}<T> must declare an element type.`,
          ),
        );
        return null;
      }

      const elementType = this.lowerTypeNode(elementNode, typeParameters);
      return elementType
        ? {
            kind: "array",
            element: elementType,
          }
        : null;
    }

    if (libraryTypeName === "Record") {
      const [keyNode, valueNode] = typeArguments;
      if (!keyNode || !valueNode || !this.isStringLikeRecordKey(keyNode)) {
        this.diagnostics.push(
          createNodeDiagnostic(
            node,
            "UNSUPPORTED_RECORD_KEY",
            "Only Record<string, T> is supported.",
          ),
        );
        return null;
      }

      const valueType = this.lowerTypeNode(valueNode, typeParameters);
      return valueType
        ? {
            kind: "dictionary",
            value: valueType,
          }
        : null;
    }

    if (isRivetSymbol(this.checker, node.typeName, "Brand")) {
      const [underlyingNode, brandNameNode] = typeArguments;
      const brandName = brandNameNode ? this.readStringLiteral(brandNameNode) : null;
      if (!underlyingNode || !brandName) {
        this.diagnostics.push(
          createNodeDiagnostic(
            node,
            "INVALID_BRAND",
            'Brand<T, "Name"> must declare an underlying type and string literal brand name.',
          ),
        );
        return null;
      }

      const underlyingType = this.lowerTypeNode(underlyingNode, typeParameters);
      return underlyingType
        ? {
            kind: "brand",
            name: brandName,
            underlying: underlyingType,
          }
        : null;
    }

    if (isRivetSymbol(this.checker, node.typeName, "Format")) {
      const [underlyingNode, formatNode] = typeArguments;
      const format = formatNode ? this.readStringLiteral(formatNode) : null;
      if (!underlyingNode || !format) {
        this.diagnostics.push(
          createNodeDiagnostic(
            node,
            "INVALID_FORMAT",
            'Format<T, "name"> must declare an underlying type and string literal format.',
          ),
        );
        return null;
      }

      const underlyingType = this.lowerTypeNode(underlyingNode, typeParameters);
      if (!underlyingType) {
        return null;
      }

      if (underlyingType.kind !== "primitive") {
        this.diagnostics.push(
          createNodeDiagnostic(
            node,
            "UNSUPPORTED_FORMAT_TARGET",
            'Format<T, "name"> currently only supports primitive underlying types.',
          ),
        );
        return null;
      }

      return {
        ...underlyingType,
        format,
      };
    }

    // Date lives in lib .d.ts files the declaration index never sees, so a
    // bare ref would dangle; lower it to its wire shape instead.
    if (libraryTypeName === "Date" && typeArguments.length === 0) {
      return {
        kind: "primitive",
        type: "string",
        format: "date-time",
      };
    }

    if (typeParameters.has(typeName) && typeArguments.length === 0) {
      return {
        kind: "typeParam",
        name: typeName,
      };
    }

    if (typeArguments.length === 0) {
      return {
        kind: "ref",
        name: typeName,
      };
    }

    const loweredTypeArgs = [];
    for (const typeArgument of typeArguments) {
      const loweredTypeArg = this.lowerTypeNode(typeArgument, typeParameters);
      if (!loweredTypeArg) {
        return null;
      }

      loweredTypeArgs.push(loweredTypeArg);
    }

    return {
      kind: "generic",
      name: typeName,
      typeArgs: loweredTypeArgs,
    };
  }

  private lowerUnionTypeNode(
    node: ts.UnionTypeNode,
    typeParameters: Set<string>,
  ): RivetType | null {
    // X10: `T | undefined` carries no JSON meaning beyond optionality (which
    // readPropertyMembers records); drop undefined members before lowering.
    const definedMembers = node.types.filter(
      (member) => member.kind !== ts.SyntaxKind.UndefinedKeyword,
    );
    const nonNullMembers = definedMembers.filter((member) => !isNullTypeNode(member));
    const isNullable = nonNullMembers.length !== definedMembers.length;

    if (nonNullMembers.length === 0) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "UNSUPPORTED_UNION",
          `Union "${node.getText(getNodeSourceFile(node))}" is not supported.`,
        ),
      );
      return null;
    }

    const loweredMembers =
      nonNullMembers.length === 1
        ? this.lowerTypeNode(nonNullMembers[0]!, typeParameters)
        : this.lowerUnionMembers(node, nonNullMembers, typeParameters);
    if (!loweredMembers) {
      return null;
    }

    // X10: `A | B | null` previously failed because the null filter only
    // applied when exactly one non-null member remained.
    return isNullable
      ? {
          kind: "nullable",
          inner: loweredMembers,
        }
      : loweredMembers;
  }

  private lowerUnionMembers(
    node: ts.UnionTypeNode,
    members: readonly ts.TypeNode[],
    typeParameters: Set<string>,
  ): RivetType | null {
    const taggedUnion = this.tryLowerTaggedUnionTypeNode(node, members, typeParameters);
    if (taggedUnion) {
      return taggedUnion;
    }

    const literalUnion = this.readLiteralUnion(members);
    if (literalUnion) {
      return literalUnion.kind === "string"
        ? { kind: "stringUnion", values: literalUnion.values }
        : { kind: "intUnion", values: literalUnion.values };
    }

    if (!members.every((member) => this.isScalarUnionMember(member))) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "UNSUPPORTED_UNION",
          `Union "${node.getText(getNodeSourceFile(node))}" is not supported.`,
        ),
      );
      return null;
    }

    const variants = members.map((member) => this.lowerUnionVariant(member, typeParameters));
    if (variants.some((variant) => variant === null)) {
      return null;
    }
    return { kind: "union", variants: variants as RivetType[] };
  }

  private isScalarUnionMember(member: ts.TypeNode): boolean {
    return (
      ts.isLiteralTypeNode(member) ||
      member.kind === ts.SyntaxKind.BooleanKeyword ||
      member.kind === ts.SyntaxKind.NumberKeyword ||
      member.kind === ts.SyntaxKind.StringKeyword
    );
  }

  private lowerUnionVariant(member: ts.TypeNode, typeParameters: Set<string>): RivetType | null {
    const literal = this.readLiteralTypeNode(member);
    return literal === null
      ? this.lowerTypeNode(member, typeParameters)
      : { kind: "literal", value: literal };
  }

  private tryLowerTaggedUnionTypeNode(
    node: ts.UnionTypeNode,
    memberNodes: readonly ts.TypeNode[],
    typeParameters: Set<string>,
  ): RivetType | null {
    const members = memberNodes.map((member) => this.readTaggedUnionMember(member));
    if (members.some((member) => member === null)) {
      return null;
    }

    const discriminator = this.resolveTaggedUnionDiscriminator(
      members as readonly TaggedUnionMemberDescriptor[],
    );
    if (!discriminator) {
      return null;
    }

    const variants = [];
    const seenTags = new Set<string>();

    for (const member of members as readonly TaggedUnionMemberDescriptor[]) {
      const discriminatorProperty = member.properties.find(
        (property) => property.name === discriminator,
      );
      const tag = discriminatorProperty && this.readLiteralTypeNode(discriminatorProperty.typeNode);
      if (!discriminatorProperty || typeof tag !== "string") {
        return null;
      }

      if (seenTags.has(tag)) {
        this.diagnostics.push(
          createNodeDiagnostic(
            discriminatorProperty.typeNode,
            "UNSUPPORTED_UNION",
            `Union "${node.getText(getNodeSourceFile(node))}" repeats discriminator value "${tag}".`,
          ),
        );
        return null;
      }
      seenTags.add(tag);

      const type = this.lowerInlineObject(member.properties, typeParameters);
      if (!type) {
        return null;
      }

      variants.push({ tag, type });
    }

    return {
      kind: "taggedUnion",
      discriminator,
      variants,
    };
  }

  private readTaggedUnionMember(member: ts.TypeNode): TaggedUnionMemberDescriptor | null {
    const properties = this.getObjectProperties(member);
    return properties ? { properties } : null;
  }

  private resolveTaggedUnionDiscriminator(
    members: readonly TaggedUnionMemberDescriptor[],
  ): string | null {
    if (members.length === 0) {
      return null;
    }

    let candidates = new Set(
      members[0].properties
        .filter((property) => this.isTaggedUnionDiscriminatorCandidate(property))
        .map((property) => property.name),
    );

    for (const member of members.slice(1)) {
      const memberCandidates = new Set(
        member.properties
          .filter((property) => this.isTaggedUnionDiscriminatorCandidate(property))
          .map((property) => property.name),
      );
      candidates = new Set([...candidates].filter((candidate) => memberCandidates.has(candidate)));
    }

    if (candidates.size !== 1) {
      return null;
    }

    return [...candidates][0] ?? null;
  }

  private isTaggedUnionDiscriminatorCandidate(property: PropertyDescriptor): boolean {
    return !property.optional && typeof this.readLiteralTypeNode(property.typeNode) === "string";
  }

  private readSecurityScheme(
    node: ts.TypeNode | undefined,
    endpoint: DiscoveredEndpointSpec,
  ): string | null {
    if (!node) {
      return null;
    }

    const propertyMap = this.createPropertyMap(node);
    if (!propertyMap) {
      this.pushDiagnosticIfAbsent(
        createNodeDiagnostic(
          node,
          "INVALID_SECURITY_SPEC",
          `Endpoint "${endpoint.contractName}.${endpoint.name}" must declare security as an object type with a string literal scheme.`,
        ),
      );
      return null;
    }

    const schemeNode = propertyMap.get("scheme");
    const securityScheme = this.readStringLiteral(schemeNode);
    if (securityScheme) {
      return securityScheme;
    }

    this.pushDiagnosticIfAbsent(
      createNodeDiagnostic(
        schemeNode ?? node,
        "INVALID_SECURITY_SPEC",
        `Endpoint "${endpoint.contractName}.${endpoint.name}" must declare security.scheme as a string literal.`,
      ),
    );
    return null;
  }

  private pushDiagnosticIfAbsent(diagnostic: ExtractionDiagnostic): void {
    const alreadyPresent = this.diagnostics.some(
      (existing) =>
        existing.code === diagnostic.code &&
        existing.filePath === diagnostic.filePath &&
        existing.line === diagnostic.line &&
        existing.column === diagnostic.column,
    );

    if (!alreadyPresent) {
      this.diagnostics.push(diagnostic);
    }
  }

  private readStringLiteral(node: ts.TypeNode | undefined): string | null {
    const value = readLiteral(this.checker, node);
    return typeof value === "string" ? value : null;
  }

  private readNumericLiteral(node: ts.TypeNode | undefined): number | null {
    const value = readLiteral(this.checker, node);
    return typeof value === "number" ? value : null;
  }

  private readBooleanLiteral(node: ts.TypeNode | undefined): boolean | null {
    const value = readLiteral(this.checker, node);
    return typeof value === "boolean" ? value : null;
  }

  /**
   * The literal of a literal type node only. Type lowering keeps an alias
   * reference such as `type Kind = "a"` as a ref (an enum-like alias), so it
   * must not resolve through aliases the way endpoint-spec reads do.
   */
  private readLiteralTypeNode(node: ts.TypeNode): LiteralValue | null {
    return ts.isLiteralTypeNode(node) ? readLiteral(this.checker, node) : null;
  }

  /** `"a" | "b"` or `1 | 2`: every member a literal type node of one kind. */
  private readLiteralUnion(
    members: readonly ts.TypeNode[],
  ): { kind: "string"; values: string[] } | { kind: "int"; values: number[] } | null {
    const values = members.map((member) => this.readLiteralTypeNode(member));
    const strings = values.filter((value) => typeof value === "string");
    const numbers = values.filter((value) => typeof value === "number");
    if (strings.length === values.length) {
      return { kind: "string", values: strings };
    }

    return numbers.length === values.length ? { kind: "int", values: numbers } : null;
  }

  private resolveTypeName(node: ts.EntityName): string {
    return resolveSymbol(this.checker, node)?.getName() ?? node.getText(getNodeSourceFile(node));
  }

  /**
   * The name of the library type `node` refers to (declared in a lib or
   * `@types` declaration file), or null when the contract source declares it.
   * `@types/node` alone declares `Blob`/`File` for node-only projects.
   */
  private libraryTypeName(node: ts.EntityName): string | null {
    const symbol = resolveSymbol(this.checker, node);
    const isLibrary = (symbol?.getDeclarations() ?? []).some(
      (declaration) => declaration.getSourceFile().isDeclarationFile,
    );
    return symbol && isLibrary ? symbol.getName() : null;
  }

  private isStringLikeRecordKey(node: ts.TypeNode): boolean {
    if (node.kind === ts.SyntaxKind.StringKeyword) {
      return true;
    }

    return this.readStringLiteral(node) !== null;
  }

  // Default success-status table, shared with the .NET extractor and the
  // type-level SuccessStatus in src/domain/runtime-types.ts:
  // POST -> 201; DELETE with a void response -> 204; everything else -> 200.
  private getDefaultSuccessStatus(httpMethod: string, hasResponseBody: boolean): number {
    switch (httpMethod) {
      case "DELETE":
        return hasResponseBody ? 200 : 204;
      case "POST":
        return 201;
      default:
        return 200;
    }
  }
}
