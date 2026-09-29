// Request and response examples: `typeof exportedConst` references read as JSON.
import ts from "typescript";
import type { HttpMethod } from "../../domain/contract.js";
import { RivetExample, type RivetEndpointExampleValue } from "../../domain/rivet-contract.js";
import {
  createNodeDiagnostic,
  createPropertyMap,
  getListEntryNodes,
  getPropertyName,
  hasModifier,
  literalValueOfType,
  readNumericLiteral,
  readStringLiteral,
  resolveAlias,
  resolveSymbol,
  type LoweringContext,
} from "./authoring-syntax.js";
import { getDefaultSuccessStatus } from "./http-status.js";

export type ResponseExampleGroup = {
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

export const JSON_MEDIA_TYPE = "application/json";

const getResponseExampleMediaType = (status: number, fileContentType: string | undefined): string =>
  status >= 200 && status < 300 && fileContentType ? fileContentType : JSON_MEDIA_TYPE;

export const parseRequestExamples = (
  ctx: LoweringContext,
  propertyMap: ReadonlyMap<string, ts.TypeNode>,
  endpointName: string,
  defaultMediaType: string,
): RivetExample[] => {
  const pluralNode = propertyMap.get("requestExamples");
  const singularNode = propertyMap.get("requestExample");
  const target: ExampleTarget = { typeNode: propertyMap.get("input"), property: "input" };

  if (pluralNode && singularNode) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        pluralNode,
        "CONFLICTING_REQUEST_EXAMPLE_SPEC",
        `Endpoint "${endpointName}" cannot declare both requestExample and requestExamples.`,
      ),
    );
    return [];
  }

  if (pluralNode) {
    const entryNodes = getListEntryNodes(ctx, pluralNode);
    if (!entryNodes) {
      ctx.diagnostics.push(
        createNodeDiagnostic(
          pluralNode,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" must declare requestExamples as an array of typeof exportedConst entries or { json: typeof exportedConst } descriptors.`,
        ),
      );
      return [];
    }

    const context = { endpointName, label: "requestExamples entries", defaultMediaType, target };
    return entryNodes.flatMap((entryNode) => parseExampleEntry(ctx, entryNode, context) ?? []);
  }

  if (!singularNode) {
    return [];
  }

  const json = readExportedConstExample(ctx, singularNode, {
    endpointName,
    label: "requestExample",
    target,
  });
  return json === null ? [] : [new RivetExample({ mediaType: defaultMediaType, json })];
};

export const parseResponseExamples = (
  ctx: LoweringContext,
  propertyMap: ReadonlyMap<string, ts.TypeNode>,
  endpointName: string,
  method: HttpMethod,
  successStatus: number | null,
  fileContentType: string | undefined,
): ResponseExampleGroup[] => {
  const pluralNode = propertyMap.get("responseExamples");
  const singularNode = propertyMap.get("successResponseExample");
  const responseNode = propertyMap.get("response");

  if (pluralNode && singularNode) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        pluralNode,
        "CONFLICTING_RESPONSE_EXAMPLE_SPEC",
        `Endpoint "${endpointName}" cannot declare both successResponseExample and responseExamples.`,
      ),
    );
    return [];
  }

  if (pluralNode) {
    const entryNodes = getListEntryNodes(ctx, pluralNode);
    if (!entryNodes) {
      ctx.diagnostics.push(
        createNodeDiagnostic(
          pluralNode,
          "INVALID_RESPONSE_EXAMPLES_SPEC",
          `Endpoint "${endpointName}" must declare responseExamples as an array of { status; examples } entries.`,
        ),
      );
      return [];
    }

    return entryNodes.flatMap(
      (entryNode) => parseResponseExampleGroup(ctx, entryNode, endpointName, fileContentType) ?? [],
    );
  }

  if (!singularNode) {
    return [];
  }

  const json = readExportedConstExample(ctx, singularNode, {
    endpointName,
    label: "successResponseExample",
    target: { typeNode: responseNode, property: "response" },
  });
  if (json === null) {
    return [];
  }

  const status =
    successStatus ??
    getDefaultSuccessStatus(
      method,
      responseNode !== undefined && responseNode.kind !== ts.SyntaxKind.VoidKeyword,
    );
  const mediaType = getResponseExampleMediaType(status, fileContentType);
  return [{ status, examples: [new RivetExample({ mediaType, json })], node: singularNode }];
};

// Status-scoped response examples are deliberately not type-checked: the
// DSL does not constrain them and C# Rivet carries example JSON verbatim.
const parseResponseExampleGroup = (
  ctx: LoweringContext,
  node: ts.TypeNode,
  endpointName: string,
  fileContentType: string | undefined,
): ResponseExampleGroup | null => {
  const propertyMap = createPropertyMap(ctx, node);
  if (!propertyMap) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        node,
        "INVALID_RESPONSE_EXAMPLES_ENTRY",
        `Endpoint "${endpointName}" responseExamples entries must be { status; examples } objects.`,
      ),
    );
    return null;
  }

  const status = readNumericLiteral(ctx, propertyMap.get("status"));
  if (status === null) {
    ctx.diagnostics.push(
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
    ctx.diagnostics.push(
      createNodeDiagnostic(
        node,
        "MISSING_RESPONSE_EXAMPLES",
        `Endpoint "${endpointName}" responseExamples entry for status ${status} must declare an examples array.`,
      ),
    );
    return null;
  }

  const entryNodes = getListEntryNodes(ctx, examplesNode);
  if (!entryNodes) {
    ctx.diagnostics.push(
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
    examples: entryNodes.flatMap((entryNode) => parseExampleEntry(ctx, entryNode, context) ?? []),
    node,
  };
};

/** One entry of an example list: `typeof exportedConst`, `{ json }` or `{ componentExampleId; resolvedJson }`. */
const parseExampleEntry = (
  ctx: LoweringContext,
  node: ts.TypeNode,
  context: ExampleReadContext & { readonly defaultMediaType: string },
): RivetExample | null => {
  const { endpointName, label } = context;
  if (ts.isTypeQueryNode(node)) {
    const json = readExportedConstExample(ctx, node, context);
    return json === null ? null : new RivetExample({ mediaType: context.defaultMediaType, json });
  }

  const propertyMap = createPropertyMap(ctx, node);
  if (!propertyMap) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        node,
        "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
        `Endpoint "${endpointName}" ${label} must be typeof exportedConst or a supported descriptor object.`,
      ),
    );
    return null;
  }

  const name = readExampleDescriptorString(ctx, propertyMap.get("name"), "name", context);
  const mediaType = readExampleDescriptorString(
    ctx,
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
      ctx.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" ${label} must use either inline json or ref-backed componentExampleId/resolvedJson fields, not both.`,
        ),
      );
      return null;
    }

    const json = readExportedConstExample(ctx, jsonNode, { ...context, label: `${label}.json` });
    return json === null ? null : new RivetExample({ mediaType: exampleMediaType, json, name });
  }

  if (componentExampleIdNode || resolvedJsonNode) {
    if (!componentExampleIdNode || !resolvedJsonNode) {
      ctx.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" ref-backed ${label} must declare both componentExampleId and resolvedJson.`,
        ),
      );
      return null;
    }

    const componentExampleId = readStringLiteral(ctx, componentExampleIdNode);
    if (!componentExampleId) {
      ctx.diagnostics.push(
        createNodeDiagnostic(
          componentExampleIdNode,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" ${label} must declare componentExampleId as a string literal.`,
        ),
      );
      return null;
    }

    const resolvedJson = readExportedConstExample(ctx, resolvedJsonNode, {
      ...context,
      label: `${label}.resolvedJson`,
    });
    return resolvedJson === null
      ? null
      : new RivetExample({ mediaType: exampleMediaType, componentExampleId, resolvedJson, name });
  }

  ctx.diagnostics.push(
    createNodeDiagnostic(
      node,
      "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
      `Endpoint "${endpointName}" ${label} must be typeof exportedConst, { json: typeof exportedConst }, or { componentExampleId: "..."; resolvedJson: typeof exportedConst }.`,
    ),
  );
  return null;
};

/**
 * Reads `typeof exportedConst` as JSON-like example data. With a target the
 * const's type must be assignable to the endpoint's input/response type.
 */
const readExportedConstExample = (
  ctx: LoweringContext,
  node: ts.TypeNode,
  context: ExampleReadContext,
): RivetEndpointExampleValue | null => {
  const { endpointName, label, target } = context;
  if (!ts.isTypeQueryNode(node)) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        node,
        "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
        `Endpoint "${endpointName}" must declare ${label} as typeof exportedConst.`,
      ),
    );
    return null;
  }

  const declaration = resolveExampleDeclaration(ctx, node.exprName);
  if (
    !declaration ||
    !declaration.initializer ||
    (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) === 0 ||
    !hasModifier(declaration, ts.ModifierFlags.Export)
  ) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        node,
        "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
        `Endpoint "${endpointName}" must declare ${label} as typeof an exported const with an initializer.`,
      ),
    );
    return null;
  }

  if (target && !target.typeNode) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        node,
        "INVALID_ENDPOINT_EXAMPLE_TYPE",
        `Endpoint "${endpointName}" ${label} requires the corresponding endpoint ${target.property} type.`,
      ),
    );
    return null;
  }

  const data = parseExampleValue(ctx, declaration.initializer);
  if (data === undefined) {
    ctx.diagnostics.push(
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
    !ctx.checker.isTypeAssignableTo(
      ctx.checker.getTypeFromTypeNode(node),
      ctx.checker.getTypeFromTypeNode(target.typeNode),
    )
  ) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        node,
        "INVALID_ENDPOINT_EXAMPLE_TYPE",
        `Endpoint "${endpointName}" ${label} must be assignable to the endpoint ${target.property} type.`,
      ),
    );
    return null;
  }

  return data;
};

/** `undefined` when absent, `null` when present but not a string literal (diagnosed). */
const readExampleDescriptorString = (
  ctx: LoweringContext,
  node: ts.TypeNode | undefined,
  propertyName: "name" | "mediaType",
  context: ExampleReadContext,
): string | null | undefined => {
  if (!node) {
    return undefined;
  }

  const value = readStringLiteral(ctx, node);
  if (value !== null) {
    return value;
  }

  ctx.diagnostics.push(
    createNodeDiagnostic(
      node,
      "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
      `Endpoint "${context.endpointName}" ${context.label} must declare ${propertyName} as a string literal when provided.`,
    ),
  );
  return null;
};

const resolveExampleDeclaration = (
  ctx: LoweringContext,
  entityName: ts.EntityName,
): ts.VariableDeclaration | null => {
  for (const declaration of resolveSymbol(ctx.checker, entityName)?.getDeclarations() ?? []) {
    if (ts.isVariableDeclaration(declaration)) {
      return declaration;
    }
  }

  return null;
};

const parseExampleValue = (
  ctx: LoweringContext,
  expression: ts.Expression,
): RivetEndpointExampleValue | undefined => {
  const unwrapped = unwrapExampleExpression(expression);

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
    const operand = parseExampleValue(ctx, unwrapped.operand);
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

      const value = parseExampleValue(ctx, element);
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
      const entry = parseExampleObjectProperty(ctx, property);
      if (!entry) {
        return undefined;
      }

      value[entry.name] = entry.value;
    }

    return value;
  }

  if (ts.isIdentifier(unwrapped)) {
    return resolveIdentifierExampleValue(ctx, unwrapped);
  }

  if (
    ts.isBinaryExpression(unwrapped) &&
    unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = parseExampleValue(ctx, unwrapped.left);
    const right = parseExampleValue(ctx, unwrapped.right);
    if (typeof left === "string" && typeof right === "string") {
      return left + right;
    }

    return undefined;
  }

  return literalValueOfType(ctx.checker, ctx.checker.getTypeAtLocation(unwrapped)) ?? undefined;
};

const resolveIdentifierExampleValue = (
  ctx: LoweringContext,
  identifier: ts.Identifier,
): RivetEndpointExampleValue | undefined => {
  for (const declaration of resolveSymbol(ctx.checker, identifier)?.getDeclarations() ?? []) {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return parseExampleValue(ctx, declaration.initializer);
    }
  }

  return undefined;
};

const parseExampleObjectProperty = (
  ctx: LoweringContext,
  property: ts.ObjectLiteralElementLike,
): { name: string; value: RivetEndpointExampleValue } | null => {
  if (ts.isPropertyAssignment(property)) {
    const propertyName = getPropertyName(property.name);
    if (!propertyName) {
      return null;
    }

    const propertyValue = parseExampleValue(ctx, property.initializer);
    return propertyValue === undefined ? null : { name: propertyName, value: propertyValue };
  }

  if (ts.isShorthandPropertyAssignment(property)) {
    const propertyValue = parseShorthandExampleValue(ctx, property);
    return propertyValue === undefined ? null : { name: property.name.text, value: propertyValue };
  }

  return null;
};

const parseShorthandExampleValue = (
  ctx: LoweringContext,
  property: ts.ShorthandPropertyAssignment,
): RivetEndpointExampleValue | undefined => {
  const symbol = ctx.checker.getShorthandAssignmentValueSymbol(property);
  if (!symbol) {
    return undefined;
  }

  const resolvedSymbol = resolveAlias(ctx.checker, symbol);
  for (const declaration of resolvedSymbol.getDeclarations() ?? []) {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return parseExampleValue(ctx, declaration.initializer);
    }
  }

  return (
    literalValueOfType(
      ctx.checker,
      ctx.checker.getTypeOfSymbolAtLocation(resolvedSymbol, property.name),
    ) ?? undefined
  );
};

const unwrapExampleExpression = (expression: ts.Expression): ts.Expression => {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    return unwrapExampleExpression(expression.expression);
  }

  return expression;
};
