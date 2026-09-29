// A discovered endpoint to its contract-JSON definition: params, responses, security.
import ts from "typescript";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import {
  RivetEndpointDefinition,
  RivetEndpointParam,
  RivetEndpointSecurity,
  RivetResponseType,
  type RivetExample,
  type RivetType,
} from "../../domain/rivet-contract.js";
import {
  createNodeDiagnostic,
  createPropertyMap,
  getListEntryNodes,
  libraryTypeName,
  readBooleanLiteral,
  readNumericLiteral,
  readStringLiteral,
  resolveTypeName,
  type LoweringContext,
  type PropertyDescriptor,
} from "./authoring-syntax.js";
import { deriveGroupName, toCamelCase, type DiscoveredEndpointSpec } from "./contract-discovery.js";
import { getDefaultSuccessStatus, isBodyForbiddenStatus } from "./http-status.js";
import {
  getObjectProperties,
  getTypeParameterScope,
  lowerOptionalTypeNode,
  lowerTypeNode,
} from "./type-lowering.js";

const BODY_HTTP_METHODS = new Set(["PATCH", "POST", "PUT"]);

const ROUTE_PARAM_PATTERN = /\{([^}]+)\}/g;

const parseRouteParamNames = (route: string): string[] =>
  [...route.matchAll(ROUTE_PARAM_PATTERN)].map((match) => match[1]);

export const lowerEndpoint = (
  ctx: LoweringContext,
  endpoint: DiscoveredEndpointSpec,
): RivetEndpointDefinition => {
  const { propertyMap, specNode, fileContentType } = endpoint;
  const inputNode = propertyMap.get("input");
  const paramsNode = propertyMap.get("params");
  const queryNode = propertyMap.get("query");
  const summary = readStringLiteral(ctx, propertyMap.get("summary")) ?? undefined;
  const description = readStringLiteral(ctx, propertyMap.get("description")) ?? undefined;
  const anonymous = readBooleanLiteral(ctx, propertyMap.get("anonymous")) ?? false;
  const securityScheme = readSecurityScheme(ctx, propertyMap.get("security"), endpoint);
  const queryAuthBool = readBooleanLiteral(ctx, propertyMap.get("queryAuth"));
  const queryAuthString = readStringLiteral(ctx, propertyMap.get("queryAuth"));
  const queryAuth =
    queryAuthBool === true
      ? { parameterName: "token" }
      : queryAuthString
        ? { parameterName: queryAuthString }
        : undefined;
  const inputType = lowerOptionalTypeNode(ctx, inputNode);
  const responseType = lowerOptionalTypeNode(ctx, propertyMap.get("response"));

  // buildExplicitEndpointParams has no multipart handling, so explicit
  // params:/query: would bypass acceptsFile and contradict the
  // multipart/form-data request media type.
  if (endpoint.acceptsFile && (paramsNode || queryNode)) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        paramsNode ?? queryNode ?? specNode,
        "INVALID_MULTIPART_INPUT",
        `Endpoint "${endpoint.contractName}.${endpoint.name}" cannot combine acceptsFile with explicit params/query declarations; declare route and form fields on the input type instead.`,
      ),
    );
  }

  const params =
    paramsNode || queryNode
      ? buildExplicitEndpointParams(ctx, endpoint, inputType, paramsNode, queryNode)
      : buildEndpointParams(ctx, endpoint, inputType);
  const responses = mergeResponseExamples(
    ctx,
    buildResponses(ctx, endpoint, responseType),
    endpoint,
  );

  if (anonymous && securityScheme) {
    ctx.diagnostics.push(
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
      ? resolveTypeName(ctx, inputNode.typeName)
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
};

const buildExplicitEndpointParams = (
  ctx: LoweringContext,
  endpoint: DiscoveredEndpointSpec,
  inputType: RivetType | null,
  paramsNode: ts.TypeNode | undefined,
  queryNode: ts.TypeNode | undefined,
): RivetEndpointParam[] => {
  const params: RivetEndpointParam[] = [];
  if (paramsNode) {
    pushObjectParams(ctx, params, paramsNode, "route", endpoint);
  }

  appendRouteParams(params, endpoint.route);

  if (queryNode) {
    pushObjectParams(ctx, params, queryNode, "query", endpoint);
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
};

const pushObjectParams = (
  ctx: LoweringContext,
  params: RivetEndpointParam[],
  node: ts.TypeNode,
  source: "route" | "query",
  endpoint: DiscoveredEndpointSpec,
): void => {
  const properties = getObjectProperties(ctx, node);
  if (!properties) {
    const slot = source === "route" ? "params" : "query";
    ctx.diagnostics.push(
      createNodeDiagnostic(
        node,
        source === "route" ? "UNSUPPORTED_PARAMS_SHAPE" : "UNSUPPORTED_QUERY_SHAPE",
        `Endpoint "${endpoint.contractName}.${endpoint.name}" must declare ${slot} as an object literal type or an interface/alias of property signatures.`,
      ),
    );
    return;
  }

  const scope = getTypeParameterScope(ctx, node);
  for (const property of properties) {
    const type = lowerTypeNode(ctx, property.typeNode, scope);
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
};

/**
 * Adds a route param for every `{placeholder}` no route param covers yet,
 * typed from `typesByLowerName` when the input declares it, else string.
 */
const appendRouteParams = (
  params: RivetEndpointParam[],
  route: string,
  typesByLowerName: ReadonlyMap<string, RivetType> = new Map(),
): void => {
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
};

const buildEndpointParams = (
  ctx: LoweringContext,
  endpoint: DiscoveredEndpointSpec,
  inputType: RivetType | null,
): RivetEndpointParam[] => {
  const inputNode = endpoint.propertyMap.get("input");
  const params: RivetEndpointParam[] = [];

  if (BODY_HTTP_METHODS.has(endpoint.method)) {
    if (endpoint.acceptsFile && inputNode) {
      return buildMultipartParams(ctx, endpoint, inputNode);
    }

    appendRouteParams(
      params,
      endpoint.route,
      inputNode ? getNamedPropertyTypes(ctx, inputNode) : undefined,
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
    appendRouteParams(params, endpoint.route);
    return params;
  }

  const objectProperties = getObjectProperties(ctx, inputNode);
  if (!objectProperties) {
    ctx.diagnostics.push(
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
  const scope = getTypeParameterScope(ctx, inputNode);
  for (const property of objectProperties) {
    const propertyType = lowerTypeNode(ctx, property.typeNode, scope);
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

  appendRouteParams(params, endpoint.route);
  return params;
};

const buildMultipartParams = (
  ctx: LoweringContext,
  endpoint: DiscoveredEndpointSpec,
  inputNode: ts.TypeNode,
): RivetEndpointParam[] => {
  const objectProperties = getObjectProperties(ctx, inputNode);
  if (!objectProperties) {
    ctx.diagnostics.push(
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
  const typeParameterScope = getTypeParameterScope(ctx, inputNode);
  let fileProperty: PropertyDescriptor | null = null;
  const formFieldProperties: PropertyDescriptor[] = [];

  for (const property of objectProperties) {
    if (routeParamNamesLower.has(property.name.toLowerCase())) {
      const propertyType = lowerTypeNode(ctx, property.typeNode, typeParameterScope);
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

    if (isFileTypeNode(ctx, property.typeNode)) {
      if (fileProperty) {
        ctx.diagnostics.push(
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
    ctx.diagnostics.push(
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
    const propertyType = lowerTypeNode(ctx, property.typeNode, typeParameterScope);
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
};

const isFileTypeNode = (ctx: LoweringContext, typeNode: ts.TypeNode): boolean => {
  if (!ts.isTypeReferenceNode(typeNode)) {
    return false;
  }

  const name = libraryTypeName(ctx, typeNode.typeName);
  return name === "Blob" || name === "File";
};

const getNamedPropertyTypes = (
  ctx: LoweringContext,
  inputNode: ts.TypeNode,
): Map<string, RivetType> => {
  const properties = getObjectProperties(ctx, inputNode);
  const propertyTypes = new Map<string, RivetType>();

  if (!properties) {
    return propertyTypes;
  }

  for (const property of properties) {
    const loweredType = lowerTypeNode(
      ctx,
      property.typeNode,
      getTypeParameterScope(ctx, inputNode),
    );
    if (!loweredType) {
      continue;
    }

    propertyTypes.set(property.name.toLowerCase(), loweredType);
  }

  return propertyTypes;
};

const buildResponses = (
  ctx: LoweringContext,
  endpoint: DiscoveredEndpointSpec,
  responseType: RivetType | null,
): RivetResponseType[] => {
  const responses: RivetResponseType[] = [];
  const responseNode = endpoint.propertyMap.get("response");
  const errorsNode = endpoint.propertyMap.get("errors");
  const errorResponses = errorsNode ? readErrorResponses(ctx, errorsNode, endpoint) : [];
  const fileResponse = endpoint.fileContentType !== undefined;
  const successStatusOverride = endpoint.successStatus;
  const hasResponseBody = responseType !== null || fileResponse;
  const defaultSuccessStatus = getDefaultSuccessStatus(endpoint.method, hasResponseBody);

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
};

const mergeResponseExamples = (
  ctx: LoweringContext,
  responses: readonly RivetResponseType[],
  endpoint: DiscoveredEndpointSpec,
): RivetResponseType[] => {
  const statuses = new Set(responses.map((response) => response.statusCode));
  const examplesByStatus = new Map<number, readonly RivetExample[]>();
  for (const group of endpoint.responseExamples) {
    if (group.examples.length > 0 && isBodyForbiddenStatus(group.status)) {
      ctx.diagnostics.push(
        createNodeDiagnostic(
          group.node,
          "BODY_FORBIDDEN_STATUS_EXAMPLE",
          `Endpoint "${endpoint.contractName}.${endpoint.name}" authors response content on body-forbidden status ${group.status} — HTTP forbids a message body on 1xx/204/205/304, so the authored example/content could never reach the wire; move it to a status that allows a body or remove it.`,
        ),
      );
    } else if (!statuses.has(group.status)) {
      ctx.diagnostics.push(
        new ExtractionDiagnostic({
          severity: "error",
          code: "UNRESOLVED_RESPONSE_EXAMPLE_STATUS",
          message: `Endpoint "${endpoint.contractName}.${endpoint.name}" declares response examples for status ${group.status}, but no matching response exists.`,
        }),
      );
    } else if (group.examples.length > 0) {
      examplesByStatus.set(group.status, group.examples);
    }
  }

  return responses.map((response) => {
    const examples = examplesByStatus.get(response.statusCode);
    return examples
      ? new RivetResponseType({
          statusCode: response.statusCode,
          dataType: response.dataType,
          description: response.description,
          examples,
        })
      : response;
  });
};

const readErrorResponses = (
  ctx: LoweringContext,
  node: ts.TypeNode,
  endpoint: DiscoveredEndpointSpec,
): RivetResponseType[] => {
  const errorEntries = getListEntryNodes(ctx, node);
  if (!errorEntries) {
    ctx.diagnostics.push(
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
    const propertyMap = createPropertyMap(ctx, element);
    if (!propertyMap) {
      ctx.diagnostics.push(
        createNodeDiagnostic(
          element,
          "INVALID_ERROR_ENTRY",
          `Endpoint "${endpoint.contractName}.${endpoint.name}" has an error entry that is not an object type.`,
        ),
      );
      continue;
    }

    const statusNode = propertyMap.get("status");
    const status = statusNode ? readNumericLiteral(ctx, statusNode) : null;
    if (status === null) {
      ctx.diagnostics.push(
        createNodeDiagnostic(
          element,
          "MISSING_ERROR_STATUS",
          `Endpoint "${endpoint.contractName}.${endpoint.name}" has an error entry without a numeric status.`,
        ),
      );
      continue;
    }

    const responseNode = propertyMap.get("response");
    const responseType = lowerOptionalTypeNode(ctx, responseNode);
    responses.push(
      new RivetResponseType({
        statusCode: status,
        dataType: responseType ?? undefined,
        description: readStringLiteral(ctx, propertyMap.get("description")) ?? undefined,
      }),
    );
  }

  return responses;
};

const readSecurityScheme = (
  ctx: LoweringContext,
  node: ts.TypeNode | undefined,
  endpoint: DiscoveredEndpointSpec,
): string | null => {
  if (!node) {
    return null;
  }

  const propertyMap = createPropertyMap(ctx, node);
  if (!propertyMap) {
    pushDiagnosticIfAbsent(
      ctx,
      createNodeDiagnostic(
        node,
        "INVALID_SECURITY_SPEC",
        `Endpoint "${endpoint.contractName}.${endpoint.name}" must declare security as an object type with a string literal scheme.`,
      ),
    );
    return null;
  }

  const schemeNode = propertyMap.get("scheme");
  const securityScheme = readStringLiteral(ctx, schemeNode);
  if (securityScheme) {
    return securityScheme;
  }

  pushDiagnosticIfAbsent(
    ctx,
    createNodeDiagnostic(
      schemeNode ?? node,
      "INVALID_SECURITY_SPEC",
      `Endpoint "${endpoint.contractName}.${endpoint.name}" must declare security.scheme as a string literal.`,
    ),
  );
  return null;
};

const pushDiagnosticIfAbsent = (ctx: LoweringContext, diagnostic: ExtractionDiagnostic): void => {
  const alreadyPresent = ctx.diagnostics.some(
    (existing) =>
      existing.code === diagnostic.code &&
      existing.filePath === diagnostic.filePath &&
      existing.line === diagnostic.line &&
      existing.column === diagnostic.column,
  );

  if (!alreadyPresent) {
    ctx.diagnostics.push(diagnostic);
  }
};
