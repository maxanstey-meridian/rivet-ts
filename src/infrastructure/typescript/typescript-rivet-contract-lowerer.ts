import path from "node:path";
import ts from "typescript";
import { RivetContractLowerer } from "../../application/ports/rivet-contract-lowerer.js";
import { ContractBundle } from "../../domain/contract-bundle.js";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import { RivetContractLoweringResult } from "../../domain/rivet-contract-lowering-result.js";
import {
  RivetContractDocument,
  type RivetContractEnum,
  RivetEndpointDefinition,
  RivetEndpointParam,
  RivetEndpointSecurity,
  RivetResponseType,
  type RivetType,
  RivetTypeDefinition,
  type RivetPropertyDefinition,
} from "../../domain/rivet-contract.js";

type SupportedDeclaration = ts.EnumDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

type ContractIndex = Map<string, Map<string, ts.TypeNode>>;

type EndpointContext = {
  contractName: string;
  endpointName: string;
  httpMethod: string;
};

type PropertyDescriptor = {
  name: string;
  typeNode: ts.TypeNode;
  optional: boolean;
  readOnly: boolean;
};

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  skipLibCheck: true,
  allowJs: false,
  noEmit: true,
  resolveJsonModule: true,
  esModuleInterop: true,
  verbatimModuleSyntax: true,
};

const EMPTY_DOCUMENT = new RivetContractDocument({});

const BODY_HTTP_METHODS = new Set(["PATCH", "POST", "PUT"]);
const ROUTE_PARAM_PATTERN = /\{([^}]+)\}/g;
const AUTHORING_HELPER_TYPE_NAMES = new Set([
  "EndpointAuthoringSpec",
  "EndpointErrorAuthoringSpec",
  "EndpointSecurityAuthoringSpec",
]);
const BUILTIN_TYPE_NAMES = new Set(["Array", "ReadonlyArray"]);

const buildProgram = (entryPath: string): ts.Program =>
  ts.createProgram([path.resolve(entryPath)], DEFAULT_COMPILER_OPTIONS);

const parseRouteParamNames = (route: string): string[] => {
  const matches = route.matchAll(ROUTE_PARAM_PATTERN);
  return [...matches].map((match) => match[1] ?? "").filter((name) => name.length > 0);
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

const isContractInterface = (node: ts.InterfaceDeclaration): boolean => {
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
      continue;
    }

    for (const type of clause.types) {
      if (type.expression.getText(getNodeSourceFile(node)) !== "Contract") {
        continue;
      }

      const [argument] = type.typeArguments ?? [];
      return Boolean(
        argument &&
        ts.isLiteralTypeNode(argument) &&
        ts.isStringLiteral(argument.literal) &&
        argument.literal.text.length > 0,
      );
    }
  }

  return false;
};

const getContractName = (node: ts.InterfaceDeclaration): string | null => {
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
      continue;
    }

    for (const type of clause.types) {
      if (type.expression.getText(getNodeSourceFile(node)) !== "Contract") {
        continue;
      }

      const [argument] = type.typeArguments ?? [];
      if (argument && ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        return argument.literal.text;
      }
    }
  }

  return null;
};

const getEndpointSpecNode = (member: ts.TypeElement): ts.TypeNode | null => {
  if (!ts.isPropertySignature(member) || !member.type) {
    return null;
  }

  const sourceFile = getNodeSourceFile(member);
  if (
    !ts.isTypeReferenceNode(member.type) ||
    member.type.typeName.getText(sourceFile) !== "Endpoint"
  ) {
    return null;
  }

  const [argument] = member.type.typeArguments ?? [];
  return argument ?? null;
};

const indexContractEndpointSpecs = (sourceFile: ts.SourceFile): ContractIndex => {
  const contracts: ContractIndex = new Map();

  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement) || !isContractInterface(statement)) {
      continue;
    }

    const contractName = getContractName(statement);
    if (!contractName) {
      continue;
    }

    const endpoints = new Map<string, ts.TypeNode>();
    for (const member of statement.members) {
      if (!ts.isPropertySignature(member) || !member.name) {
        continue;
      }

      const endpointName = getPropertyName(member.name);
      const specNode = getEndpointSpecNode(member);
      if (!endpointName || !specNode) {
        continue;
      }

      endpoints.set(endpointName, specNode);
    }

    contracts.set(contractName, endpoints);
  }

  return contracts;
};

const indexDeclarations = (
  program: ts.Program,
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

      if (ts.isInterfaceDeclaration(statement) && isContractInterface(statement)) {
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
  public constructor() {
    super();
  }

  public async lower(bundle: ContractBundle): Promise<RivetContractLoweringResult> {
    const diagnostics = [...bundle.diagnostics];
    const program = buildProgram(bundle.entryPath);
    const sourceFile = program.getSourceFile(path.resolve(bundle.entryPath));

    if (!sourceFile) {
      diagnostics.push(
        new ExtractionDiagnostic({
          severity: "error",
          code: "ENTRY_NOT_FOUND",
          message: `Could not load entry file: ${path.resolve(bundle.entryPath)}`,
          filePath: path.resolve(bundle.entryPath),
        }),
      );

      return new RivetContractLoweringResult({
        document: EMPTY_DOCUMENT,
        diagnostics,
      });
    }

    const checker = program.getTypeChecker();
    const declarations = indexDeclarations(program, diagnostics);
    const contractIndex = indexContractEndpointSpecs(sourceFile);
    const typeDefinitions = new Map<string, RivetTypeDefinition>();
    const enums = new Map<string, RivetContractEnum>();
    const endpoints: RivetEndpointDefinition[] = [];
    const referencedTypeNames = new Set<string>();
    const emissionContext = new TypeEmissionContext(checker, declarations, diagnostics);

    for (const contract of bundle.contracts) {
      const endpointSpecs = contractIndex.get(contract.name);
      if (!endpointSpecs) {
        diagnostics.push(
          new ExtractionDiagnostic({
            severity: "error",
            code: "CONTRACT_NOT_FOUND",
            message: `Could not locate extracted contract "${contract.name}" during lowering.`,
            filePath: contract.sourceFilePath,
          }),
        );
        continue;
      }

      for (const endpoint of contract.endpoints) {
        const specLiteral = endpointSpecs.get(endpoint.name);
        if (!specLiteral) {
          diagnostics.push(
            new ExtractionDiagnostic({
              severity: "error",
              code: "ENDPOINT_SPEC_NOT_FOUND",
              message: `Could not locate endpoint "${contract.name}.${endpoint.name}" during lowering.`,
              filePath: contract.sourceFilePath,
            }),
          );
          continue;
        }

        const loweredEndpoint = emissionContext.lowerEndpoint(specLiteral, {
          contractName: contract.name,
          endpointName: endpoint.name,
          httpMethod: endpoint.method,
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
    });
  }
}

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
    const inputType = this.lowerOptionalTypeNode(inputNode);
    const responseType = this.lowerOptionalTypeNode(responseNode);

    const params = this.buildEndpointParams(routeLiteral, context, inputNode, inputType);
    const responses = this.buildResponses(
      specNode,
      context,
      successStatus,
      responseNode,
      responseType,
      fileResponse,
    );

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

    return new RivetEndpointDefinition({
      name: toCamelCase(context.endpointName),
      httpMethod: context.httpMethod,
      routeTemplate: routeLiteral,
      params,
      returnType: responseType ?? undefined,
      controllerName: deriveControllerName(context.contractName),
      responses,
      summary,
      description,
      security,
      fileContentType,
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
    for (const property of typeDefinition.properties) {
      collectTypeReferences(property.type, references);
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
      if (!member.initializer) {
        this.diagnostics.push(
          createNodeDiagnostic(
            member,
            "UNSUPPORTED_ENUM_MEMBER",
            `Enum "${declaration.name.text}" must use explicit string or numeric literal members.`,
          ),
        );
        return null;
      }

      if (
        ts.isStringLiteral(member.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(member.initializer)
      ) {
        stringValues.push(member.initializer.text);
        continue;
      }

      if (ts.isNumericLiteral(member.initializer)) {
        intValues.push(Number(member.initializer.text));
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
    const properties = this.readTypeDefinitionProperties(declaration);

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

  private readTypeDefinitionProperties(
    declaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
  ): PropertyDescriptor[] | null {
    if (ts.isInterfaceDeclaration(declaration)) {
      const properties = this.readPropertyMembers(
        declaration.members,
        `Type "${declaration.name.text}"`,
      );

      if (!properties) {
        return null;
      }

      return properties;
    }

    if (ts.isTypeLiteralNode(declaration.type)) {
      return this.readPropertyMembers(declaration.type.members, `Type "${declaration.name.text}"`);
    }

    this.diagnostics.push(
      createNodeDiagnostic(
        declaration.type,
        "UNSUPPORTED_TYPE_ALIAS",
        `Type alias "${declaration.name.text}" must be an object type or a literal-union enum.`,
      ),
    );
    return null;
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
          }),
        );
      }

      if (inputType) {
        params.push(
          new RivetEndpointParam({
            name: "body",
            type: inputType,
            source: "body",
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
        }),
      );
    }

    return params;
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

    if (responseType) {
      responses.push(
        new RivetResponseType({
          statusCode: successStatusOverride ?? this.getDefaultSuccessStatus(context.httpMethod),
          dataType: responseType,
        }),
      );
    } else if (
      fileResponse ||
      successStatusOverride !== null ||
      errorResponses.length > 0 ||
      this.getDefaultSuccessStatus(context.httpMethod) !== 200 ||
      (responseNode !== undefined && responseNode.kind !== ts.SyntaxKind.VoidKeyword)
    ) {
      responses.push(
        new RivetResponseType({
          statusCode: successStatusOverride ?? this.getDefaultSuccessStatus(context.httpMethod),
        }),
      );
    }

    responses.push(...errorResponses);
    responses.sort((left, right) => left.statusCode - right.statusCode);
    return responses;
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

      properties.push({
        name: propertyName,
        typeNode: member.type,
        optional: Boolean(member.questionToken),
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
      return this.readPropertyMembers(declaration.members, `Type "${name}"`);
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
    const nonNullMembers = node.types.filter((member) => !isNullTypeNode(member));
    if (nonNullMembers.length === 1 && nonNullMembers.length !== node.types.length) {
      const innerType = this.lowerTypeNode(nonNullMembers[0]!, typeParameters);
      return innerType
        ? {
            kind: "nullable",
            inner: innerType,
          }
        : null;
    }

    const stringValues: string[] = [];
    const intValues: number[] = [];
    for (const member of node.types) {
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

  private getDefaultSuccessStatus(httpMethod: string): number {
    switch (httpMethod) {
      case "DELETE":
        return 204;
      case "POST":
        return 201;
      default:
        return 200;
    }
  }
}
