import ts from "typescript";
import { RivetContractLowerer } from "../../application/ports/rivet-contract-lowerer.js";
import {
  EndpointExampleSpec,
  type EndpointExampleValue,
  ResponseExamplesSpec,
  type HttpMethod,
} from "../../domain/contract.js";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import {
  type DiscoveredContract,
  RivetContractLoweringResult,
} from "../../domain/rivet-contract-lowering-result.js";
import {
  RivetContractDocument,
  type RivetContractEnum,
  RivetEndpointDefinition,
  RivetEndpointParam,
  RivetRequestExample,
  RivetResponseExample,
  RivetEndpointSecurity,
  RivetResponseType,
  type RivetType,
  RivetTypeDefinition,
  type RivetPropertyDefinition,
} from "../../domain/rivet-contract.js";
import { mapTypeScriptDiagnostics, resolveTypeScriptProject } from "./typescript-project.js";

type SupportedDeclaration = ts.EnumDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

type DiscoveredEndpointSpec = {
  name: string;
  specNode: ts.TypeNode;
  method: HttpMethod;
  route: string;
  formEncoded: boolean;
  acceptsFile: boolean;
  hasInput: boolean;
  hasParams: boolean;
  hasQuery: boolean;
  requestExamples: readonly EndpointExampleSpec[];
  responseExamples: readonly ResponseExamplesSpec[];
};

type DiscoveredContractSpec = {
  name: string;
  sourceFilePath: string;
  endpoints: readonly DiscoveredEndpointSpec[];
};

type EndpointContext = {
  contractName: string;
  endpointName: string;
  httpMethod: string;
  formEncoded: boolean;
  acceptsFile: boolean;
  requestExamples?: readonly EndpointExampleSpec[];
  responseExamples?: readonly ResponseExamplesSpec[];
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
const BUILTIN_TYPE_NAMES = new Set(["Array", "ReadonlyArray"]);
// Example-list containers accept a broader builtin set than the type lowering
// path does (inherited from the contract frontend this pass absorbed).
const EXAMPLE_CONTAINER_TYPE_NAMES = new Set([
  "Array",
  "Record",
  "ReadonlyArray",
  "String",
  "Number",
  "Boolean",
  "Promise",
]);
const MULTIPART_FILE_TYPE_NAMES = new Set(["Blob", "File"]);
const DEFAULT_REQUEST_EXAMPLE_MEDIA_TYPE = "application/json";

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

const getModifiers = (node: ts.Node): readonly ts.Modifier[] =>
  ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];

const hasExportModifier = (node: ts.Node): boolean =>
  getModifiers(node).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

const hasReadonlyModifier = (node: ts.Node): boolean =>
  getModifiers(node).some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword);

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

// X6: resolve the heritage expression's symbol so renamed Contract imports
// (import { Contract as C }) are recognized; raw text kept as a fast path.
const getContractHeritageType = (
  node: ts.InterfaceDeclaration,
  checker: ts.TypeChecker,
): ts.ExpressionWithTypeArguments | null => {
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
      continue;
    }

    for (const type of clause.types) {
      if (type.expression.getText(getNodeSourceFile(node)) === "Contract") {
        return type;
      }

      const symbol = checker.getSymbolAtLocation(type.expression);
      const resolvedSymbol =
        symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      if (resolvedSymbol?.getName() === "Contract") {
        return type;
      }
    }
  }

  return null;
};

const isContractInterface = (node: ts.InterfaceDeclaration, checker: ts.TypeChecker): boolean =>
  getContractHeritageType(node, checker) !== null;

const getContractName = (node: ts.InterfaceDeclaration, checker: ts.TypeChecker): string | null => {
  const heritageType = getContractHeritageType(node, checker);
  const [argument] = heritageType?.typeArguments ?? [];
  if (
    argument &&
    ts.isLiteralTypeNode(argument) &&
    ts.isStringLiteral(argument.literal) &&
    argument.literal.text.length > 0
  ) {
    return argument.literal.text;
  }

  return null;
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

      if (!hasExportModifier(statement)) {
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
    case "nullable":
      collectTypeReferences(type.inner, references);
      return;
    case "ref":
      references.add(type.name);
      return;
    case "intUnion":
    case "primitive":
    case "stringUnion":
    case "typeParam":
      return;
  }
};

export class TypeScriptRivetContractLowerer extends RivetContractLowerer {
  public constructor(private readonly tsconfigPath?: string) {
    super();
  }

  /**
   * Single AST→document pass (X13 collapse): one tsconfig parse, one
   * ts.Program, one semantic check. Contract discovery (formerly the
   * TypeScript contract frontend) and lowering share the same checker.
   */
  public async lower(entryPath: string): Promise<RivetContractLoweringResult> {
    const project = resolveTypeScriptProject(entryPath, this.tsconfigPath);
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
        const loweredEndpoint = emissionContext.lowerEndpoint(endpoint.specNode, {
          contractName: contract.name,
          endpointName: endpoint.name,
          httpMethod: endpoint.method,
          formEncoded: endpoint.formEncoded,
          acceptsFile: endpoint.acceptsFile,
          requestExamples:
            endpoint.requestExamples.length > 0 ? endpoint.requestExamples : undefined,
          responseExamples:
            endpoint.responseExamples.length > 0 ? endpoint.responseExamples : undefined,
        });

        if (!loweredEndpoint) {
          continue;
        }

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
      types: [...typeDefinitions.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
      enums: [...enums.values()].sort((left, right) => left.name.localeCompare(right.name)),
      endpoints,
    });

    return new RivetContractLoweringResult({
      document,
      diagnostics,
      contracts: contracts.map(toDiscoveredContract),
    });
  }
}

const toDiscoveredContract = (contract: DiscoveredContractSpec): DiscoveredContract => ({
  name: contract.name,
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

        const endpoint = this.discoverEndpoint(member.type, endpointName);
        if (endpoint) {
          endpoints.push(endpoint);
        }
      }

      contracts.push({
        name: contractName,
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
  ): DiscoveredEndpointSpec | null {
    if (
      !ts.isTypeReferenceNode(typeNode) ||
      typeNode.typeName.getText(getNodeSourceFile(typeNode)) !== "Endpoint"
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
    const requestExamples = this.parseRequestExamples(
      propertyMap.get("requestExamples"),
      propertyMap.get("requestExample"),
      propertyMap.get("input"),
      endpointName,
    );
    const responseExamples = this.parseResponseExamples(
      propertyMap.get("responseExamples"),
      propertyMap.get("successResponseExample"),
      propertyMap.get("response"),
      method,
      successStatus,
      endpointName,
    );

    return {
      name: endpointName,
      specNode,
      method,
      route,
      formEncoded: this.readBooleanLiteral(propertyMap.get("formEncoded")) ?? false,
      acceptsFile: this.readBooleanLiteral(propertyMap.get("acceptsFile")) ?? false,
      hasInput: propertyMap.has("input"),
      hasParams: propertyMap.has("params"),
      hasQuery: propertyMap.has("query"),
      requestExamples,
      responseExamples,
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

  // ------------------------------------------------------------------
  // Endpoint example extraction (absorbed from the deleted frontend).
  // Examples are parsed at discovery time because they read const
  // initializers and run type-assignability checks against the checker.
  // ------------------------------------------------------------------

  private parseRequestExamples(
    pluralNode: ts.TypeNode | undefined,
    singularNode: ts.TypeNode | undefined,
    targetNode: ts.TypeNode | undefined,
    endpointName: string,
  ): EndpointExampleSpec[] {
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
      const entryNodes = this.getExampleEntryNodes(pluralNode);
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

      const examples: EndpointExampleSpec[] = [];
      for (const entryNode of entryNodes) {
        const example = this.parseRequestExampleEntry(entryNode, targetNode, endpointName);
        if (example) {
          examples.push(example);
        }
      }

      return examples;
    }

    const requestExample = this.parseEndpointExample(
      singularNode,
      targetNode,
      "requestExample",
      "input",
      endpointName,
    );

    return requestExample ? [requestExample] : [];
  }

  private parseResponseExamples(
    pluralNode: ts.TypeNode | undefined,
    legacySingularNode: ts.TypeNode | undefined,
    targetNode: ts.TypeNode | undefined,
    method: HttpMethod,
    successStatus: number | null,
    endpointName: string,
  ): ResponseExamplesSpec[] {
    if (pluralNode && legacySingularNode) {
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
      const entryNodes = this.getExampleEntryNodes(pluralNode);
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

      const result: ResponseExamplesSpec[] = [];
      for (const entryNode of entryNodes) {
        const parsed = this.parseResponseExamplesEntry(entryNode, targetNode, endpointName);
        if (parsed) {
          result.push(parsed);
        }
      }

      return result;
    }

    if (legacySingularNode) {
      const legacyExample = this.parseEndpointExample(
        legacySingularNode,
        targetNode,
        "successResponseExample",
        "response",
        endpointName,
      );

      if (!legacyExample) {
        return [];
      }

      const resolvedStatus =
        successStatus ??
        this.getDefaultSuccessStatus(
          method,
          targetNode !== undefined && targetNode.kind !== ts.SyntaxKind.VoidKeyword,
        );
      return [new ResponseExamplesSpec({ status: resolvedStatus, examples: [legacyExample] })];
    }

    return [];
  }

  private parseResponseExamplesEntry(
    node: ts.TypeNode,
    targetNode: ts.TypeNode | undefined,
    endpointName: string,
  ): ResponseExamplesSpec | null {
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

    const exampleEntryNodes = this.getExampleEntryNodes(examplesNode);
    if (!exampleEntryNodes) {
      this.diagnostics.push(
        createNodeDiagnostic(
          examplesNode,
          "INVALID_RESPONSE_EXAMPLES",
          `Endpoint "${endpointName}" responseExamples entry for status ${status} must declare examples as an array of typeof exportedConst entries.`,
        ),
      );
      return null;
    }

    const examples: EndpointExampleSpec[] = [];
    for (const exampleNode of exampleEntryNodes) {
      const example = this.parseResponseExampleEntry(
        exampleNode,
        `responseExamples[${status}].examples entries`,
        endpointName,
      );
      if (example) {
        examples.push(example);
      }
    }

    return new ResponseExamplesSpec({ status, examples });
  }

  private parseResponseExampleEntry(
    node: ts.TypeNode,
    propertyName: string,
    endpointName: string,
  ): EndpointExampleSpec | null {
    if (ts.isTypeQueryNode(node)) {
      const declaration = this.resolveExampleDeclaration(node.exprName);
      if (
        !declaration ||
        !declaration.initializer ||
        !this.isConstVariableDeclaration(declaration) ||
        !this.isExportedVariableDeclaration(declaration)
      ) {
        this.diagnostics.push(
          createNodeDiagnostic(
            node,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" must declare ${propertyName} as typeof an exported const with an initializer.`,
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
            `Endpoint "${endpointName}" ${propertyName} must resolve to a JSON-like const initializer.`,
          ),
        );
        return null;
      }

      return new EndpointExampleSpec({ data });
    }

    const propertyMap = this.createPropertyMap(node);
    if (!propertyMap) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" ${propertyName} must be typeof exportedConst or a supported descriptor object.`,
        ),
      );
      return null;
    }

    const name = this.parseExampleDescriptorStringLiteral(
      propertyMap.get("name"),
      "name",
      endpointName,
    );
    const mediaType = this.parseExampleDescriptorStringLiteral(
      propertyMap.get("mediaType"),
      "mediaType",
      endpointName,
    );

    if (name === null || mediaType === null) {
      return null;
    }

    const jsonNode = propertyMap.get("json");
    const componentExampleIdNode = propertyMap.get("componentExampleId");
    const resolvedJsonNode = propertyMap.get("resolvedJson");

    if (jsonNode) {
      if (componentExampleIdNode || resolvedJsonNode) {
        this.diagnostics.push(
          createNodeDiagnostic(
            node,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" ${propertyName} must use either inline json or ref-backed componentExampleId/resolvedJson fields, not both.`,
          ),
        );
        return null;
      }

      const data = this.parseResponseExampleData(jsonNode, `${propertyName}.json`, endpointName);
      if (data === null) {
        return null;
      }

      return new EndpointExampleSpec({
        data,
        name: name ?? undefined,
        mediaType: mediaType ?? undefined,
      });
    }

    if (componentExampleIdNode || resolvedJsonNode) {
      if (!componentExampleIdNode || !resolvedJsonNode) {
        this.diagnostics.push(
          createNodeDiagnostic(
            node,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" ref-backed ${propertyName} must declare both componentExampleId and resolvedJson.`,
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
            `Endpoint "${endpointName}" ${propertyName} must declare componentExampleId as a string literal.`,
          ),
        );
        return null;
      }

      const resolvedJson = this.parseResponseExampleData(
        resolvedJsonNode,
        `${propertyName}.resolvedJson`,
        endpointName,
      );
      if (resolvedJson === null) {
        return null;
      }

      return new EndpointExampleSpec({
        componentExampleId,
        resolvedJson,
        name: name ?? undefined,
        mediaType: mediaType ?? undefined,
      });
    }

    this.diagnostics.push(
      createNodeDiagnostic(
        node,
        "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
        `Endpoint "${endpointName}" ${propertyName} descriptor must declare json or componentExampleId/resolvedJson.`,
      ),
    );
    return null;
  }

  private parseResponseExampleData(
    node: ts.TypeNode,
    propertyName: string,
    endpointName: string,
  ): EndpointExampleValue | null {
    if (!ts.isTypeQueryNode(node)) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" must declare ${propertyName} as typeof exportedConst.`,
        ),
      );
      return null;
    }

    const declaration = this.resolveExampleDeclaration(node.exprName);
    if (
      !declaration ||
      !declaration.initializer ||
      !this.isConstVariableDeclaration(declaration) ||
      !this.isExportedVariableDeclaration(declaration)
    ) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" must declare ${propertyName} as typeof an exported const with an initializer.`,
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
          `Endpoint "${endpointName}" ${propertyName} must resolve to a JSON-like const initializer.`,
        ),
      );
      return null;
    }

    return data;
  }

  private parseRequestExampleEntry(
    node: ts.TypeNode,
    targetNode: ts.TypeNode | undefined,
    endpointName: string,
  ): EndpointExampleSpec | null {
    if (ts.isTypeQueryNode(node)) {
      return this.parseEndpointExample(
        node,
        targetNode,
        "requestExamples entries",
        "input",
        endpointName,
      );
    }

    const propertyMap = this.createPropertyMap(node);
    if (!propertyMap) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" requestExamples entries must be typeof exportedConst or a supported descriptor object.`,
        ),
      );
      return null;
    }

    const name = this.parseExampleDescriptorStringLiteral(
      propertyMap.get("name"),
      "name",
      endpointName,
    );
    const mediaType = this.parseExampleDescriptorStringLiteral(
      propertyMap.get("mediaType"),
      "mediaType",
      endpointName,
    );

    if (name === null || mediaType === null) {
      return null;
    }

    const jsonNode = propertyMap.get("json");
    const componentExampleIdNode = propertyMap.get("componentExampleId");
    const resolvedJsonNode = propertyMap.get("resolvedJson");

    if (jsonNode) {
      if (componentExampleIdNode || resolvedJsonNode) {
        this.diagnostics.push(
          createNodeDiagnostic(
            node,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" requestExamples entries must use either inline json or ref-backed componentExampleId/resolvedJson fields, not both.`,
          ),
        );
        return null;
      }

      const data = this.parseEndpointExampleData(
        jsonNode,
        targetNode,
        "requestExamples entries.json",
        "input",
        endpointName,
      );
      if (data === null) {
        return null;
      }

      return new EndpointExampleSpec({
        data,
        name: name ?? undefined,
        mediaType: mediaType ?? undefined,
      });
    }

    if (componentExampleIdNode || resolvedJsonNode) {
      if (!componentExampleIdNode || !resolvedJsonNode) {
        this.diagnostics.push(
          createNodeDiagnostic(
            node,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" ref-backed requestExamples entries must declare both componentExampleId and resolvedJson.`,
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
            `Endpoint "${endpointName}" requestExamples entries must declare componentExampleId as a string literal.`,
          ),
        );
        return null;
      }

      const resolvedJson = this.parseEndpointExampleData(
        resolvedJsonNode,
        targetNode,
        "requestExamples entries.resolvedJson",
        "input",
        endpointName,
      );
      if (resolvedJson === null) {
        return null;
      }

      return new EndpointExampleSpec({
        componentExampleId,
        resolvedJson,
        name: name ?? undefined,
        mediaType: mediaType ?? undefined,
      });
    }

    this.diagnostics.push(
      createNodeDiagnostic(
        node,
        "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
        `Endpoint "${endpointName}" requestExamples entries must be typeof exportedConst, { json: typeof exportedConst }, or { componentExampleId: "..."; resolvedJson: typeof exportedConst }.`,
      ),
    );
    return null;
  }

  private parseEndpointExample(
    node: ts.TypeNode | undefined,
    targetNode: ts.TypeNode | undefined,
    propertyName: string,
    targetPropertyName: "input" | "response",
    endpointName: string,
  ): EndpointExampleSpec | null {
    const data = this.parseEndpointExampleData(
      node,
      targetNode,
      propertyName,
      targetPropertyName,
      endpointName,
    );

    return data === null ? null : new EndpointExampleSpec({ data });
  }

  private parseEndpointExampleData(
    node: ts.TypeNode | undefined,
    targetNode: ts.TypeNode | undefined,
    propertyName: string,
    targetPropertyName: "input" | "response",
    endpointName: string,
  ): EndpointExampleValue | null {
    if (!node) {
      return null;
    }

    if (!ts.isTypeQueryNode(node)) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" must declare ${propertyName} as typeof exportedConst.`,
        ),
      );
      return null;
    }

    const declaration = this.resolveExampleDeclaration(node.exprName);
    if (
      !declaration ||
      !declaration.initializer ||
      !this.isConstVariableDeclaration(declaration) ||
      !this.isExportedVariableDeclaration(declaration)
    ) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" must declare ${propertyName} as typeof an exported const with an initializer.`,
        ),
      );
      return null;
    }

    if (!targetNode) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ENDPOINT_EXAMPLE_TYPE",
          `Endpoint "${endpointName}" ${propertyName} requires the corresponding endpoint ${targetPropertyName} type.`,
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
          `Endpoint "${endpointName}" ${propertyName} must resolve to a JSON-like const initializer.`,
        ),
      );
      return null;
    }

    const exampleType = this.checker.getTypeFromTypeNode(node);
    const targetType = this.checker.getTypeFromTypeNode(targetNode);
    if (!this.checker.isTypeAssignableTo(exampleType, targetType)) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ENDPOINT_EXAMPLE_TYPE",
          `Endpoint "${endpointName}" ${propertyName} must be assignable to the endpoint ${targetPropertyName} type.`,
        ),
      );
      return null;
    }

    return data;
  }

  private parseExampleDescriptorStringLiteral(
    node: ts.TypeNode | undefined,
    propertyName: "name" | "mediaType",
    endpointName: string,
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
        `Endpoint "${endpointName}" requestExamples entries must declare ${propertyName} as a string literal when provided.`,
      ),
    );
    return null;
  }

  private getExampleEntryNodes(node: ts.TypeNode): ts.TypeNode[] | null {
    if (ts.isParenthesizedTypeNode(node)) {
      return this.getExampleEntryNodes(node.type);
    }

    if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
      return this.getExampleEntryNodes(node.type);
    }

    if (ts.isTupleTypeNode(node)) {
      return [...node.elements];
    }

    if (ts.isArrayTypeNode(node)) {
      return [node.elementType];
    }

    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      EXAMPLE_CONTAINER_TYPE_NAMES.has(node.typeName.text)
    ) {
      const [elementType] = node.typeArguments ?? [];
      return elementType ? [elementType] : null;
    }

    const resolvedNode = this.resolveAliasedTypeNode(node);
    return resolvedNode ? this.getExampleEntryNodes(resolvedNode) : null;
  }

  private resolveExampleDeclaration(entityName: ts.EntityName): ts.VariableDeclaration | null {
    const symbol = this.checker.getSymbolAtLocation(entityName);
    if (!symbol) {
      return null;
    }

    const resolvedSymbol =
      (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? this.checker.getAliasedSymbol(symbol) : symbol;

    for (const declaration of resolvedSymbol.getDeclarations() ?? []) {
      if (ts.isVariableDeclaration(declaration)) {
        return declaration;
      }
    }

    return null;
  }

  private isConstVariableDeclaration(declaration: ts.VariableDeclaration): boolean {
    return (
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0
    );
  }

  private isExportedVariableDeclaration(declaration: ts.VariableDeclaration): boolean {
    return (
      ts.isVariableDeclarationList(declaration.parent) &&
      ts.isVariableStatement(declaration.parent.parent) &&
      (declaration.parent.parent.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) ??
        false)
    );
  }

  private parseExampleValue(expression: ts.Expression): EndpointExampleValue | undefined {
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
      const values: EndpointExampleValue[] = [];
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
      const value: Record<string, EndpointExampleValue> = {};
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

    return this.parseLiteralValueFromType(unwrapped);
  }

  private resolveIdentifierExampleValue(
    identifier: ts.Identifier,
  ): EndpointExampleValue | undefined {
    const symbol = this.checker.getSymbolAtLocation(identifier);
    if (!symbol) {
      return undefined;
    }

    const resolvedSymbol =
      (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? this.checker.getAliasedSymbol(symbol) : symbol;

    for (const declaration of resolvedSymbol.getDeclarations() ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return this.parseExampleValue(declaration.initializer);
      }
    }

    return undefined;
  }

  private parseExampleObjectProperty(
    property: ts.ObjectLiteralElementLike,
  ): { name: string; value: EndpointExampleValue } | null {
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
  ): EndpointExampleValue | undefined {
    const symbol = this.checker.getShorthandAssignmentValueSymbol(property);
    if (!symbol) {
      return undefined;
    }

    const resolvedSymbol =
      (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? this.checker.getAliasedSymbol(symbol) : symbol;

    for (const declaration of resolvedSymbol.getDeclarations() ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return this.parseExampleValue(declaration.initializer);
      }
    }

    return this.parseLiteralValueFromTsType(
      this.checker.getTypeOfSymbolAtLocation(resolvedSymbol, property.name),
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

  private parseLiteralValueFromType(
    expression: ts.Expression,
  ): string | number | boolean | undefined {
    return this.parseLiteralValueFromTsType(this.checker.getTypeAtLocation(expression));
  }

  private parseLiteralValueFromTsType(type: ts.Type): string | number | boolean | undefined {
    if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) {
      return (type as ts.StringLiteralType).value;
    }

    if ((type.flags & ts.TypeFlags.NumberLiteral) !== 0) {
      return (type as ts.NumberLiteralType).value;
    }

    if ((type.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
      return this.checker.typeToString(type) === "true";
    }

    return undefined;
  }

  public lowerEndpoint(
    specNode: ts.TypeNode,
    context: EndpointContext,
  ): RivetEndpointDefinition | null {
    const propertyMap = this.createPropertyMap(specNode);
    if (!propertyMap) {
      this.diagnostics.push(
        createNodeDiagnostic(
          specNode,
          "INVALID_ENDPOINT_SPEC",
          `Endpoint "${context.contractName}.${context.endpointName}" must use a type literal spec or a type alias that resolves to one.`,
        ),
      );
      return null;
    }

    const routeNode = propertyMap.get("route");
    const routeLiteral = routeNode ? this.readStringLiteral(routeNode) : null;

    if (!routeLiteral) {
      this.diagnostics.push(
        createNodeDiagnostic(
          specNode,
          "INCOMPLETE_ENDPOINT",
          `Endpoint "${context.contractName}.${context.endpointName}" is missing a string literal route.`,
        ),
      );
      return null;
    }

    const inputNode = propertyMap.get("input");
    const paramsNode = propertyMap.get("params");
    const queryNode = propertyMap.get("query");
    const responseNode = propertyMap.get("response");
    const successStatus = this.readNumericLiteral(propertyMap.get("successStatus"));
    const summary = this.readStringLiteral(propertyMap.get("summary")) ?? undefined;
    const description = this.readStringLiteral(propertyMap.get("description")) ?? undefined;
    const anonymous = this.readBooleanLiteral(propertyMap.get("anonymous")) ?? false;
    const securityScheme = this.readSecurityScheme(propertyMap.get("security"), context);
    const fileResponse = this.readBooleanLiteral(propertyMap.get("fileResponse")) ?? false;
    const fileContentType = fileResponse
      ? (this.readStringLiteral(propertyMap.get("fileContentType")) ?? "application/octet-stream")
      : undefined;
    const queryAuthBool = this.readBooleanLiteral(propertyMap.get("queryAuth"));
    const queryAuthString = this.readStringLiteral(propertyMap.get("queryAuth"));
    const queryAuth =
      queryAuthBool === true
        ? { parameterName: "token" }
        : queryAuthString
          ? { parameterName: queryAuthString }
          : undefined;
    const inputType = this.lowerOptionalTypeNode(inputNode);
    const responseType = this.lowerOptionalTypeNode(responseNode);

    // X7: buildExplicitEndpointParams has no multipart handling, so explicit
    // params:/query: would silently bypass acceptsFile and emit output that
    // contradicts the multipart/form-data request media type.
    if (context.acceptsFile && (paramsNode || queryNode)) {
      this.diagnostics.push(
        createNodeDiagnostic(
          paramsNode ?? queryNode ?? specNode,
          "INVALID_MULTIPART_INPUT",
          `Endpoint "${context.contractName}.${context.endpointName}" cannot combine acceptsFile with explicit params/query declarations; declare route and form fields on the input type instead.`,
        ),
      );
    }

    const params =
      paramsNode || queryNode
        ? this.buildExplicitEndpointParams(
            routeLiteral,
            context,
            inputNode,
            inputType,
            paramsNode,
            queryNode,
          )
        : this.buildEndpointParams(routeLiteral, context, inputNode, inputType);
    const baseResponses = this.buildResponses(
      specNode,
      context,
      successStatus,
      responseNode,
      responseType,
      fileResponse,
    );
    const responses = this.mergeResponseExamples(baseResponses, context, fileContentType);

    if (anonymous && securityScheme) {
      const conflictingNode = propertyMap.get("security") ?? specNode;
      this.diagnostics.push(
        createNodeDiagnostic(
          conflictingNode,
          "CONFLICTING_SECURITY_SPEC",
          `Endpoint "${context.contractName}.${context.endpointName}" cannot declare both anonymous and security.`,
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
    const requestExampleDefaultMediaType = context.acceptsFile
      ? "multipart/form-data"
      : context.formEncoded
        ? "application/x-www-form-urlencoded"
        : DEFAULT_REQUEST_EXAMPLE_MEDIA_TYPE;
    const requestExamples = context.requestExamples
      ?.map((requestExample) =>
        this.lowerRequestExample(requestExample, requestExampleDefaultMediaType),
      )
      .filter((requestExample): requestExample is RivetRequestExample => requestExample !== null);

    const inputTypeName =
      context.acceptsFile &&
      inputNode &&
      ts.isTypeReferenceNode(inputNode) &&
      !inputNode.typeArguments?.length
        ? this.resolveTypeName(inputNode.typeName)
        : undefined;

    return new RivetEndpointDefinition({
      name: toCamelCase(context.endpointName),
      httpMethod: context.httpMethod,
      routeTemplate: routeLiteral,
      params,
      returnType: responseType ?? undefined,
      controllerName: deriveGroupName(context.contractName),
      responses,
      summary,
      description,
      requestExamples: requestExamples?.length ? requestExamples : undefined,
      security,
      fileContentType,
      inputTypeName,
      isFormEncoded: context.formEncoded || undefined,
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
    // X16: auto-numbered members (enum Role { Admin, User }) follow standard
    // TypeScript semantics: start at 0 and continue from the previous numeric
    // value. String members invalidate further auto-numbering (as in tsc).
    let nextAutoValue: number | null = 0;

    for (const member of declaration.members) {
      if (!member.initializer) {
        if (nextAutoValue === null) {
          this.diagnostics.push(
            createNodeDiagnostic(
              member,
              "UNSUPPORTED_ENUM_MEMBER",
              `Enum "${declaration.name.text}" has a member without an initializer after a non-numeric member.`,
            ),
          );
          return null;
        }

        intValues.push(nextAutoValue);
        nextAutoValue += 1;
        continue;
      }

      if (
        ts.isStringLiteral(member.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(member.initializer)
      ) {
        stringValues.push(member.initializer.text);
        nextAutoValue = null;
        continue;
      }

      if (ts.isNumericLiteral(member.initializer)) {
        const value = Number(member.initializer.text);
        intValues.push(value);
        nextAutoValue = value + 1;
        continue;
      }

      // X16: negative initializers (= -1) parse as prefix-unary expressions.
      if (
        ts.isPrefixUnaryExpression(member.initializer) &&
        member.initializer.operator === ts.SyntaxKind.MinusToken &&
        ts.isNumericLiteral(member.initializer.operand)
      ) {
        const value = -Number(member.initializer.operand.text);
        intValues.push(value);
        nextAutoValue = value + 1;
        continue;
      }

      this.diagnostics.push(
        createNodeDiagnostic(
          member,
          "UNSUPPORTED_ENUM_MEMBER",
          `Enum "${declaration.name.text}" must use explicit string or numeric literal members.`,
        ),
      );
      return null;
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

    const stringValues: string[] = [];
    const intValues: number[] = [];
    for (const member of declaration.type.types) {
      if (!ts.isLiteralTypeNode(member)) {
        return null;
      }

      if (ts.isStringLiteral(member.literal)) {
        stringValues.push(member.literal.text);
        continue;
      }

      if (ts.isNumericLiteral(member.literal)) {
        intValues.push(Number(member.literal.text));
        continue;
      }

      return null;
    }

    if (stringValues.length > 0 && intValues.length === 0) {
      return {
        name: declaration.name.text,
        values: stringValues,
      };
    }

    if (intValues.length > 0 && stringValues.length === 0) {
      return {
        name: declaration.name.text,
        intValues,
      };
    }

    return null;
  }

  private lowerTypeDefinition(
    declaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
  ): RivetTypeDefinition | null {
    const typeParameters =
      declaration.typeParameters?.map((parameter) => parameter.name.text) ?? [];
    if (ts.isInterfaceDeclaration(declaration)) {
      const properties = this.readInterfaceProperties(
        declaration,
        `Type "${declaration.name.text}"`,
      );

      if (!properties) {
        return null;
      }

      const loweredProperties: RivetPropertyDefinition[] = [];
      for (const property of properties) {
        const loweredType = this.lowerTypeNode(property.typeNode, new Set(typeParameters));
        if (!loweredType) {
          return null;
        }

        loweredProperties.push({
          name: property.name,
          type: loweredType,
          optional: property.optional,
          readOnly: property.readOnly || undefined,
        });
      }

      return new RivetTypeDefinition({
        name: declaration.name.text,
        typeParameters,
        properties: loweredProperties,
      });
    }

    if (ts.isTypeLiteralNode(declaration.type)) {
      const properties = this.readPropertyMembers(
        declaration.type.members,
        `Type "${declaration.name.text}"`,
      );
      if (!properties) {
        return null;
      }

      const loweredProperties: RivetPropertyDefinition[] = [];
      for (const property of properties) {
        const loweredType = this.lowerTypeNode(property.typeNode, new Set(typeParameters));
        if (!loweredType) {
          return null;
        }

        loweredProperties.push({
          name: property.name,
          type: loweredType,
          optional: property.optional,
          readOnly: property.readOnly || undefined,
        });
      }

      return new RivetTypeDefinition({
        name: declaration.name.text,
        typeParameters,
        properties: loweredProperties,
      });
    }

    const loweredType = this.lowerTypeNode(declaration.type, new Set(typeParameters));
    if (!loweredType) {
      return null;
    }

    return new RivetTypeDefinition({
      name: declaration.name.text,
      typeParameters,
      type: loweredType,
    });
  }

  private buildExplicitEndpointParams(
    route: string,
    context: EndpointContext,
    inputNode: ts.TypeNode | undefined,
    inputType: RivetType | null,
    paramsNode: ts.TypeNode | undefined,
    queryNode: ts.TypeNode | undefined,
  ): RivetEndpointParam[] {
    const params: RivetEndpointParam[] = [];

    if (paramsNode) {
      const properties = this.getObjectProperties(paramsNode);
      if (!properties) {
        // X4: non-object params: shapes were previously discarded silently.
        this.diagnostics.push(
          createNodeDiagnostic(
            paramsNode,
            "UNSUPPORTED_PARAMS_SHAPE",
            `Endpoint "${context.contractName}.${context.endpointName}" must declare params as an object literal type or an interface/alias of property signatures.`,
          ),
        );
      } else {
        for (const property of properties) {
          const propertyType = this.lowerTypeNode(
            property.typeNode,
            this.getTypeParameterScope(paramsNode),
          );
          if (propertyType) {
            params.push(
              new RivetEndpointParam({
                name: property.name,
                type: propertyType,
                source: "route",
                isOptional: property.optional,
              }),
            );
          }
        }
      }
    }

    // X3: route placeholders not covered by params: previously vanished;
    // emit fallback string route params like the implicit branches do.
    const coveredRouteParams = new Set(
      params.filter((param) => param.source === "route").map((param) => param.name.toLowerCase()),
    );
    for (const routeParamName of parseRouteParamNames(route)) {
      if (!coveredRouteParams.has(routeParamName.toLowerCase())) {
        params.push(
          new RivetEndpointParam({
            name: routeParamName,
            type: { kind: "primitive", type: "string" },
            source: "route",
            isOptional: false,
          }),
        );
      }
    }

    if (queryNode) {
      const properties = this.getObjectProperties(queryNode);
      if (!properties) {
        // X4: non-object query: shapes were previously discarded silently.
        this.diagnostics.push(
          createNodeDiagnostic(
            queryNode,
            "UNSUPPORTED_QUERY_SHAPE",
            `Endpoint "${context.contractName}.${context.endpointName}" must declare query as an object literal type or an interface/alias of property signatures.`,
          ),
        );
      } else {
        for (const property of properties) {
          const propertyType = this.lowerTypeNode(
            property.typeNode,
            this.getTypeParameterScope(queryNode),
          );
          if (propertyType) {
            params.push(
              new RivetEndpointParam({
                name: property.name,
                type: propertyType,
                source: "query",
                isOptional: property.optional,
              }),
            );
          }
        }
      }
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

  private buildEndpointParams(
    route: string,
    context: EndpointContext,
    inputNode: ts.TypeNode | undefined,
    inputType: RivetType | null,
  ): RivetEndpointParam[] {
    const routeParamNames = parseRouteParamNames(route);
    const hasBody = BODY_HTTP_METHODS.has(context.httpMethod);
    const params: RivetEndpointParam[] = [];

    if (hasBody) {
      if (context.acceptsFile && inputNode) {
        return this.buildMultipartParams(routeParamNames, inputNode, context);
      }

      const matchedRouteTypes = inputNode
        ? this.getNamedPropertyTypes(inputNode)
        : new Map<string, RivetType>();
      for (const routeParamName of routeParamNames) {
        params.push(
          new RivetEndpointParam({
            name: routeParamName,
            type: matchedRouteTypes.get(routeParamName.toLowerCase()) ?? {
              kind: "primitive",
              type: "string",
            },
            source: "route",
            isOptional: false,
          }),
        );
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

    if (!inputNode) {
      for (const routeParamName of routeParamNames) {
        params.push(
          new RivetEndpointParam({
            name: routeParamName,
            type: {
              kind: "primitive",
              type: "string",
            },
            source: "route",
            isOptional: false,
          }),
        );
      }

      return params;
    }

    const objectProperties = this.getObjectProperties(inputNode);
    if (!objectProperties) {
      this.diagnostics.push(
        createNodeDiagnostic(
          inputNode,
          "UNSUPPORTED_INPUT_SHAPE",
          `Endpoint "${context.contractName}.${context.endpointName}" must use an object-like input type for ${context.httpMethod} parameters.`,
        ),
      );
      return params;
    }

    for (const property of objectProperties) {
      const propertyType = this.lowerTypeNode(
        property.typeNode,
        this.getTypeParameterScope(inputNode),
      );
      if (!propertyType) {
        continue;
      }

      const source = routeParamNames.some(
        (routeParamName) => routeParamName.toLowerCase() === property.name.toLowerCase(),
      )
        ? "route"
        : "query";

      params.push(
        new RivetEndpointParam({
          name: property.name,
          type: propertyType,
          source,
          isOptional: property.optional,
        }),
      );
    }

    // X3: route placeholders with no matching input property previously
    // vanished on non-body methods; emit fallback string route params like
    // the no-input and body-method branches do.
    const coveredRouteParams = new Set(
      params.filter((param) => param.source === "route").map((param) => param.name.toLowerCase()),
    );
    for (const routeParamName of routeParamNames) {
      if (!coveredRouteParams.has(routeParamName.toLowerCase())) {
        params.push(
          new RivetEndpointParam({
            name: routeParamName,
            type: { kind: "primitive", type: "string" },
            source: "route",
            isOptional: false,
          }),
        );
      }
    }

    return params;
  }

  private buildMultipartParams(
    routeParamNames: string[],
    inputNode: ts.TypeNode,
    context: EndpointContext,
  ): RivetEndpointParam[] {
    const objectProperties = this.getObjectProperties(inputNode);
    if (!objectProperties) {
      this.diagnostics.push(
        createNodeDiagnostic(
          inputNode,
          "INVALID_MULTIPART_INPUT",
          `Endpoint "${context.contractName}.${context.endpointName}" must use an object-like input type for multipart parameters.`,
        ),
      );
      return [];
    }

    const routeParamNamesLower = new Set(routeParamNames.map((name) => name.toLowerCase()));
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
              `Endpoint "${context.contractName}.${context.endpointName}" must have exactly one Blob or File property for multipart upload, but found multiple.`,
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
          `Endpoint "${context.contractName}.${context.endpointName}" must have exactly one Blob or File property for multipart upload, but found none.`,
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

    const name = this.resolveTypeName(typeNode.typeName);
    return MULTIPART_FILE_TYPE_NAMES.has(name);
  }

  private lowerRequestExample(
    example: EndpointExampleSpec,
    defaultMediaType: string,
  ): RivetRequestExample | null {
    const mediaType = example.mediaType ?? defaultMediaType;

    if (example.data !== undefined) {
      return new RivetRequestExample({
        mediaType,
        json: example.data,
        name: example.name,
      });
    }

    if (example.componentExampleId && example.resolvedJson !== undefined) {
      return new RivetRequestExample({
        mediaType,
        componentExampleId: example.componentExampleId,
        resolvedJson: example.resolvedJson,
        name: example.name,
      });
    }

    this.diagnostics.push(
      new ExtractionDiagnostic({
        severity: "error",
        code: "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
        message:
          "Request example must resolve to either inline json or componentExampleId/resolvedJson.",
      }),
    );
    return null;
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
    specNode: ts.TypeNode,
    context: EndpointContext,
    successStatusOverride: number | null,
    responseNode: ts.TypeNode | undefined,
    responseType: RivetType | null,
    fileResponse: boolean,
  ): RivetResponseType[] {
    const responses: RivetResponseType[] = [];
    const errorsNode = this.createPropertyMap(specNode)?.get("errors");
    const errorResponses = errorsNode ? this.readErrorResponses(errorsNode, context) : [];
    const hasResponseBody = responseType !== null || fileResponse;
    const defaultSuccessStatus = this.getDefaultSuccessStatus(context.httpMethod, hasResponseBody);

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
    context: EndpointContext,
    fileContentType: string | undefined,
  ): RivetResponseType[] {
    if (!context.responseExamples || context.responseExamples.length === 0) {
      return responses;
    }

    const responsesByStatus = new Map<number, number>();
    for (let i = 0; i < responses.length; i++) {
      responsesByStatus.set(responses[i]!.statusCode, i);
    }

    const merged = [...responses];
    for (const group of context.responseExamples) {
      const index = responsesByStatus.get(group.status);
      if (index === undefined) {
        this.diagnostics.push(
          new ExtractionDiagnostic({
            severity: "error",
            code: "UNRESOLVED_RESPONSE_EXAMPLE_STATUS",
            message: `Endpoint "${context.contractName}.${context.endpointName}" declares response examples for status ${group.status}, but no matching response exists.`,
          }),
        );
        continue;
      }

      const existing = merged[index]!;
      const examples = group.examples
        .map((example) => this.lowerResponseExample(example, group.status, fileContentType))
        .filter((example): example is RivetResponseExample => example !== null);

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

  private lowerResponseExample(
    example: EndpointExampleSpec,
    statusCode: number,
    fileContentType: string | undefined,
  ): RivetResponseExample | null {
    const isSuccessStatus = statusCode >= 200 && statusCode < 300;
    const defaultMediaType =
      isSuccessStatus && fileContentType ? fileContentType : DEFAULT_REQUEST_EXAMPLE_MEDIA_TYPE;
    const mediaType = example.mediaType ?? defaultMediaType;

    if (example.data !== undefined) {
      return new RivetResponseExample({
        mediaType,
        json: example.data,
        name: example.name,
      });
    }

    if (example.componentExampleId && example.resolvedJson !== undefined) {
      return new RivetResponseExample({
        mediaType,
        componentExampleId: example.componentExampleId,
        resolvedJson: example.resolvedJson,
        name: example.name,
      });
    }

    this.diagnostics.push(
      new ExtractionDiagnostic({
        severity: "error",
        code: "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
        message:
          "Response example must resolve to either inline json or componentExampleId/resolvedJson.",
      }),
    );
    return null;
  }

  private readErrorResponses(node: ts.TypeNode, context: EndpointContext): RivetResponseType[] {
    const errorEntries = this.getErrorEntryNodes(node);
    if (!errorEntries) {
      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ERRORS_SPEC",
          `Endpoint "${context.contractName}.${context.endpointName}" must declare errors as an array or tuple type.`,
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
            `Endpoint "${context.contractName}.${context.endpointName}" has an error entry that is not an object type.`,
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
            `Endpoint "${context.contractName}.${context.endpointName}" has an error entry without a numeric status.`,
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

  private getErrorEntryNodes(node: ts.TypeNode): ts.TypeNode[] | null {
    if (ts.isParenthesizedTypeNode(node)) {
      return this.getErrorEntryNodes(node.type);
    }

    if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
      return this.getErrorEntryNodes(node.type);
    }

    if (ts.isTupleTypeNode(node)) {
      return [...node.elements];
    }

    if (ts.isArrayTypeNode(node)) {
      return [node.elementType];
    }

    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      BUILTIN_TYPE_NAMES.has(node.typeName.text)
    ) {
      const [elementType] = node.typeArguments ?? [];
      return elementType ? [elementType] : null;
    }

    const resolvedNode = this.resolveAliasedTypeNode(node);
    return resolvedNode ? this.getErrorEntryNodes(resolvedNode) : null;
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
    return ts.isTypeAliasDeclaration(parent) && AUTHORING_HELPER_TYPE_NAMES.has(parent.name.text);
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
    const symbol = this.checker.getSymbolAtLocation(type.expression);
    const resolvedSymbol =
      symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0
        ? this.checker.getAliasedSymbol(symbol)
        : symbol;
    const name = resolvedSymbol?.getName();
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
        readOnly: hasReadonlyModifier(member),
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
      if (!properties) {
        return null;
      }

      const loweredProperties = [];
      for (const property of properties) {
        if (property.optional) {
          this.diagnostics.push(
            createNodeDiagnostic(
              property.typeNode,
              "UNSUPPORTED_INLINE_OPTIONAL_PROPERTY",
              `Inline object property "${property.name}" cannot be optional.`,
            ),
          );
          return null;
        }

        const loweredPropertyType = this.lowerTypeNode(property.typeNode, typeParameters);
        if (!loweredPropertyType) {
          return null;
        }

        loweredProperties.push({
          name: property.name,
          type: loweredPropertyType,
        });
      }

      return {
        kind: "inlineObject",
        properties: loweredProperties,
      };
    }

    if (ts.isTypeReferenceNode(node)) {
      return this.lowerTypeReferenceNode(node, typeParameters);
    }

    if (ts.isUnionTypeNode(node)) {
      return this.lowerUnionTypeNode(node, typeParameters);
    }

    if (ts.isLiteralTypeNode(node)) {
      if (ts.isStringLiteral(node.literal)) {
        return {
          kind: "stringUnion",
          values: [node.literal.text],
        };
      }

      if (ts.isNumericLiteral(node.literal)) {
        return {
          kind: "intUnion",
          values: [Number(node.literal.text)],
        };
      }
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
    const typeArguments = node.typeArguments ?? [];

    if (typeName === "Array" || typeName === "ReadonlyArray") {
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

    if (typeName === "Record") {
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

    if (typeName === "Brand") {
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

    if (typeName === "Format") {
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

    // X8: Date lives in lib .d.ts files the declaration index never sees, so
    // a bare ref would dangle and later fail with a context-free
    // TYPE_NOT_FOUND. Lower it to its wire shape instead.
    if (typeName === "Date" && typeArguments.length === 0 && !this.declarations.has("Date")) {
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

    const stringValues: string[] = [];
    const intValues: number[] = [];
    for (const member of members) {
      if (!ts.isLiteralTypeNode(member)) {
        this.diagnostics.push(
          createNodeDiagnostic(
            node,
            "UNSUPPORTED_UNION",
            `Union "${node.getText(getNodeSourceFile(node))}" is not supported.`,
          ),
        );
        return null;
      }

      if (ts.isStringLiteral(member.literal)) {
        stringValues.push(member.literal.text);
        continue;
      }

      if (ts.isNumericLiteral(member.literal)) {
        intValues.push(Number(member.literal.text));
        continue;
      }

      this.diagnostics.push(
        createNodeDiagnostic(
          node,
          "UNSUPPORTED_UNION",
          `Union "${node.getText(getNodeSourceFile(node))}" is not supported.`,
        ),
      );
      return null;
    }

    if (stringValues.length > 0 && intValues.length === 0) {
      return {
        kind: "stringUnion",
        values: stringValues,
      };
    }

    if (intValues.length > 0 && stringValues.length === 0) {
      return {
        kind: "intUnion",
        values: intValues,
      };
    }

    this.diagnostics.push(
      createNodeDiagnostic(
        node,
        "UNSUPPORTED_UNION",
        `Union "${node.getText(getNodeSourceFile(node))}" is not supported.`,
      ),
    );
    return null;
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
      if (
        !discriminatorProperty ||
        !ts.isLiteralTypeNode(discriminatorProperty.typeNode) ||
        !ts.isStringLiteral(discriminatorProperty.typeNode.literal)
      ) {
        return null;
      }

      const tag = discriminatorProperty.typeNode.literal.text;
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

      const loweredProperties = [];
      for (const property of member.properties) {
        if (property.optional) {
          this.diagnostics.push(
            createNodeDiagnostic(
              property.typeNode,
              "UNSUPPORTED_UNION",
              `Union "${node.getText(getNodeSourceFile(node))}" cannot use optional properties in tagged union variants.`,
            ),
          );
          return null;
        }

        const loweredPropertyType = this.lowerTypeNode(property.typeNode, typeParameters);
        if (!loweredPropertyType) {
          return null;
        }

        loweredProperties.push({
          name: property.name,
          type: loweredPropertyType,
        });
      }

      variants.push({
        tag,
        type: {
          kind: "inlineObject" as const,
          properties: loweredProperties,
        },
      });
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
    return (
      !property.optional &&
      ts.isLiteralTypeNode(property.typeNode) &&
      ts.isStringLiteral(property.typeNode.literal)
    );
  }

  private readSecurityScheme(
    node: ts.TypeNode | undefined,
    context: EndpointContext,
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
          `Endpoint "${context.contractName}.${context.endpointName}" must declare security as an object type with a string literal scheme.`,
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
        `Endpoint "${context.contractName}.${context.endpointName}" must declare security.scheme as a string literal.`,
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
    if (!node || !ts.isLiteralTypeNode(node)) {
      return null;
    }

    if (ts.isStringLiteral(node.literal) || ts.isNoSubstitutionTemplateLiteral(node.literal)) {
      return node.literal.text;
    }

    return null;
  }

  private readNumericLiteral(node: ts.TypeNode | undefined): number | null {
    if (!node || !ts.isLiteralTypeNode(node) || !ts.isNumericLiteral(node.literal)) {
      return null;
    }

    return Number(node.literal.text);
  }

  private readBooleanLiteral(node: ts.TypeNode | undefined): boolean | null {
    if (!node || !ts.isLiteralTypeNode(node)) {
      return null;
    }

    if (node.literal.kind === ts.SyntaxKind.TrueKeyword) {
      return true;
    }

    if (node.literal.kind === ts.SyntaxKind.FalseKeyword) {
      return false;
    }

    return null;
  }

  private resolveTypeName(node: ts.EntityName): string {
    const symbol = this.checker.getSymbolAtLocation(node);
    if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      return this.checker.getAliasedSymbol(symbol).getName();
    }

    return symbol?.getName() ?? node.getText(getNodeSourceFile(node));
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
