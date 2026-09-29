// Finds the entry file's contracts and parses each endpoint spec once.
import ts from "typescript";
import type { HttpMethod } from "../../domain/contract.js";
import type { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import type { DiscoveredContract } from "../../domain/rivet-contract-lowering-result.js";
import type { RivetExample } from "../../domain/rivet-contract.js";
import {
  createNodeDiagnostic,
  createPropertyMap,
  getPropertyName,
  hasModifier,
  isRivetSymbol,
  readBooleanLiteral,
  readLiteral,
  readNumericLiteral,
  readStringLiteral,
  type LoweringContext,
  type SupportedDeclaration,
} from "./authoring-syntax.js";
import {
  JSON_MEDIA_TYPE,
  parseRequestExamples,
  parseResponseExamples,
  type ResponseExampleGroup,
} from "./endpoint-examples.js";

export type DiscoveredEndpointSpec = {
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

type DiscoveredContractSpec = {
  name: string;
  exportedName: string;
  sourceFilePath: string;
  endpoints: readonly DiscoveredEndpointSpec[];
};

const HTTP_METHODS: ReadonlySet<string> = new Set<HttpMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

const isHttpMethod = (value: string): value is HttpMethod => HTTP_METHODS.has(value);

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

export const indexDeclarations = (
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

export const toDiscoveredContract = (contract: DiscoveredContractSpec): DiscoveredContract => ({
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

/**
 * Every entry-file interface extending `Contract<"Name">`. An interface that
 * opted into the DSL either yields a contract or a diagnostic, never nothing.
 */
export const discoverContracts = (
  ctx: LoweringContext,
  sourceFile: ts.SourceFile,
): DiscoveredContractSpec[] => {
  const contracts: DiscoveredContractSpec[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement)) {
      continue;
    }

    const contractHeritage = getContractHeritageType(statement, ctx.checker);
    if (!contractHeritage) {
      continue;
    }

    const contractName = getContractName(statement, ctx.checker);
    if (contractName === null) {
      ctx.diagnostics.push(
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

      const endpointName = getPropertyName(member.name);
      if (!endpointName) {
        ctx.diagnostics.push(
          createNodeDiagnostic(
            member,
            "UNSUPPORTED_ENDPOINT_NAME",
            "Computed endpoint names are not supported; use an identifier or a string literal.",
          ),
        );
        continue;
      }

      const endpoint = discoverEndpoint(ctx, member.type, endpointName, contractName);
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
};

const discoverEndpoint = (
  ctx: LoweringContext,
  typeNode: ts.TypeNode,
  endpointName: string,
  contractName: string,
): DiscoveredEndpointSpec | null => {
  if (
    !ts.isTypeReferenceNode(typeNode) ||
    !isRivetSymbol(ctx.checker, typeNode.typeName, "Endpoint")
  ) {
    ctx.diagnostics.push(
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
    ctx.diagnostics.push(
      createNodeDiagnostic(
        typeNode,
        "INVALID_ENDPOINT_SPEC",
        `Endpoint "${endpointName}" must declare an endpoint authoring spec.`,
      ),
    );
    return null;
  }

  // A generic spec alias (Endpoint<CrudSpec<T>>) would lower the alias's
  // unsubstituted type parameters, so it is refused rather than guessed.
  if (ts.isTypeReferenceNode(specNode) && (specNode.typeArguments?.length ?? 0) > 0) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        specNode,
        "UNSUPPORTED_GENERIC_ENDPOINT_SPEC",
        `Endpoint "${endpointName}" uses a generic endpoint spec alias; generic spec aliases are not supported. Inline the spec or use a non-generic alias.`,
      ),
    );
    return null;
  }

  const propertyMap = createPropertyMap(ctx, specNode);
  if (!propertyMap) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        typeNode,
        "INVALID_ENDPOINT_SPEC",
        `Endpoint "${endpointName}" must use a type literal spec or a type alias that resolves to one.`,
      ),
    );
    return null;
  }

  const method = parseHttpMethod(ctx, propertyMap.get("method"), endpointName);
  const route = readStringLiteral(ctx, propertyMap.get("route"));

  if (!method || !route) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        specNode,
        "INCOMPLETE_ENDPOINT",
        `Endpoint "${endpointName}" must declare both method and route.`,
      ),
    );
    return null;
  }

  const successStatus = readNumericLiteral(ctx, propertyMap.get("successStatus"));
  const formEncoded = readBooleanLiteral(ctx, propertyMap.get("formEncoded")) ?? false;
  const acceptsFile = readBooleanLiteral(ctx, propertyMap.get("acceptsFile")) ?? false;
  const fileContentType =
    readBooleanLiteral(ctx, propertyMap.get("fileResponse")) === true
      ? (readStringLiteral(ctx, propertyMap.get("fileContentType")) ?? "application/octet-stream")
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
    requestExamples: parseRequestExamples(ctx, propertyMap, endpointName, requestMediaType),
    responseExamples: parseResponseExamples(
      ctx,
      propertyMap,
      endpointName,
      method,
      successStatus,
      fileContentType,
    ),
  };
};

const parseHttpMethod = (
  ctx: LoweringContext,
  node: ts.TypeNode | undefined,
  endpointName: string,
): HttpMethod | null => {
  const method = readStringLiteral(ctx, node);
  if (!node || !method) {
    return null;
  }

  if (!isHttpMethod(method)) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        node,
        "UNSUPPORTED_HTTP_METHOD",
        `Endpoint "${endpointName}" uses unsupported HTTP method "${method}".`,
      ),
    );
    return null;
  }

  return method;
};
