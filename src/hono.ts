import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  asRivetHandler,
  type ContractEndpointKey,
  type RivetHandler,
  type RivetHandlerOwner,
  type RivetHandlerOwnerWithInput,
  toLoweredEndpointName,
} from "./domain/handler-types.js";
import type { RivetEndpointDefinition } from "./domain/rivet-contract.js";

/**
 * A domain type as TypeScript infers it for an imported `.json` module: string
 * literal unions widen to `string`, so `import contract from "…json"` type-checks.
 */
type ImportedJson<T> = T extends string
  ? string
  : T extends number | boolean | null | undefined
    ? T
    : T extends readonly (infer TElement)[]
      ? readonly ImportedJson<TElement>[]
      : { readonly [TKey in keyof T]: ImportedJson<T[TKey]> };

type ContractEndpointJson = ImportedJson<
  Pick<
    RivetEndpointDefinition,
    | "name"
    | "httpMethod"
    | "routeTemplate"
    | "controllerName"
    | "params"
    | "responses"
    | "fileContentType"
    | "isFormEncoded"
  >
>;

type ContractEndpointParamJson = ContractEndpointJson["params"][number];

type ContractEndpointParamTypeJson = ContractEndpointParamJson["type"];

/** The lowered contract JSON (`rivet-ts --out`), as the routes read it. */
export type ContractJson = {
  readonly endpoints: readonly ContractEndpointJson[];
};

type RivetHeadersInit = Record<string, string | string[]>;

export type RivetInvokable<
  TContract,
  TKey extends ContractEndpointKey<TContract>,
> = RivetHandlerOwnerWithInput<TContract, TKey>;

/**
 * A class with any constructor. `any[]` is the constructor-arguments wildcard:
 * `unknown[]` rejects typed constructors and `never[]` forbids calling one, and a
 * `resolveHandler` must be able to construct whatever class it is handed.
 */
type HandlerClass<TInstance> = new (...args: any[]) => TInstance;

export type RivetInvokableClass<
  TContract,
  TKey extends ContractEndpointKey<TContract>,
> = HandlerClass<RivetInvokable<TContract, TKey>>;

type HonoHandlerEntry<TContract, TKey extends ContractEndpointKey<TContract>> =
  | RivetHandler<TContract, TKey>
  | RivetInvokableClass<TContract, TKey>;

type HonoRichHandlerEntry<TContract, TKey extends ContractEndpointKey<TContract>> = {
  readonly handler: HonoHandlerEntry<TContract, TKey>;
  readonly middleware?: ReadonlyArray<MiddlewareHandler>;
};

type HonoRouteEntry<TContract, TKey extends ContractEndpointKey<TContract>> =
  | HonoHandlerEntry<TContract, TKey>
  | HonoRichHandlerEntry<TContract, TKey>;

type HandlerMap<TContract> = Partial<{
  readonly [TKey in ContractEndpointKey<TContract>]: HonoRouteEntry<TContract, TKey>;
}>;

type RegisterRivetHonoRoutesOptions<TContract> = {
  readonly handlers: HandlerMap<TContract>;
  readonly group?: string;
  readonly resolveHandler?: <THandler>(
    Handler: HandlerClass<THandler>,
    context: Context,
  ) => THandler;
};

/** The shape every handler entry is called through once the endpoint is resolved at runtime. */
type RuntimeHandler = (input?: Record<string, unknown>) => Promise<unknown>;

/** 204/205/304 forbid a response body. */
const isBodylessStatus = (status: number): boolean =>
  status === 204 || status === 205 || status === 304;

/**
 * Route placeholders bind to params case-insensitively (as in ASP.NET), so each
 * Hono segment is named after the contract param it binds to.
 */
const toHonoRoute = (endpoint: ContractEndpointJson): string => {
  const routeParamNames = new Map(
    endpoint.params
      .filter((param) => param.source === "route")
      .map((param) => [param.name.toLowerCase(), param.name]),
  );
  return endpoint.routeTemplate.replace(
    /\{([^}]+)\}/g,
    (_, placeholder: string) => `:${routeParamNames.get(placeholder.toLowerCase()) ?? placeholder}`,
  );
};

const isHandlerClassToken = <TContract, TKey extends ContractEndpointKey<TContract>>(
  value: HonoHandlerEntry<TContract, TKey>,
): value is RivetInvokableClass<TContract, TKey> => {
  if (typeof value !== "function") {
    return false;
  }

  const prototype = value.prototype as { handle?: unknown; invoke?: unknown } | undefined;
  return typeof prototype?.handle === "function" || typeof prototype?.invoke === "function";
};

const isRichHandlerEntry = <TContract, TKey extends ContractEndpointKey<TContract>>(
  value: HonoRouteEntry<TContract, TKey>,
): value is HonoRichHandlerEntry<TContract, TKey> =>
  typeof value === "object" && value !== null && "handler" in value;

const createHandlerResolutionError = (message: string): Error => {
  const error = new Error(message);
  error.name = "RivetHonoRegistrationError";
  return error;
};

const resolveHandlerEntry = <TContract, TKey extends ContractEndpointKey<TContract>>(
  endpointName: string,
  handlerEntry: HonoHandlerEntry<TContract, TKey>,
  resolveHandler: RegisterRivetHonoRoutesOptions<TContract>["resolveHandler"],
  context: Context,
): RuntimeHandler => {
  if (!isHandlerClassToken(handlerEntry)) {
    if (typeof handlerEntry !== "function") {
      throw createHandlerResolutionError(
        `Handler for endpoint "${endpointName}" must be a plain function or a class with a prototype "handle" or "invoke" method.`,
      );
    }
    // The handler map is typed per endpoint key; the runtime dispatches by the
    // endpoint it resolved, so every handler is called through one shape.
    return handlerEntry as RuntimeHandler;
  }

  const owner = resolveHandler ? resolveHandler(handlerEntry, context) : new handlerEntry();
  return asRivetHandler(owner) as RuntimeHandler;
};

// Request-binding failures surface as structured 400s through the same
// RivetHttpError path handlers use, so the error envelope is uniform:
// { code, message } — matching the diagnostic vocabulary used elsewhere.
const createBindingError = (code: string, message: string): RivetHttpError =>
  rivetHttpError(400, { code, message });

const unwrapNullableParamType = (
  type: ContractEndpointParamTypeJson,
): ContractEndpointParamTypeJson =>
  "inner" in type && type.kind === "nullable" ? unwrapNullableParamType(type.inner) : type;

const isParamOptional = (param: ContractEndpointParamJson): boolean =>
  param.isOptional || param.type.kind === "nullable";

// Coerces a raw string value to the contract-declared param type. Only
// number/boolean primitives (and intUnion, which is numeric on the wire) are
// coerced; strings, enums, and unknown kinds pass through unchanged.
const coerceScalarParamValue = (
  raw: string,
  type: ContractEndpointParamTypeJson,
  paramName: string,
  source: string,
): string | number | boolean => {
  const resolved = unwrapNullableParamType(type);
  const primitive = "type" in resolved && resolved.kind === "primitive" ? resolved.type : undefined;

  if (resolved.kind === "intUnion" || primitive === "number") {
    const value = raw.trim() === "" ? Number.NaN : Number(raw);
    if (Number.isNaN(value)) {
      throw createBindingError(
        "INVALID_PARAMETER_VALUE",
        `Expected a number for ${source} parameter "${paramName}" but received "${raw}".`,
      );
    }
    return value;
  }

  if (primitive === "boolean") {
    if (raw === "true") {
      return true;
    }
    if (raw === "false") {
      return false;
    }
    throw createBindingError(
      "INVALID_PARAMETER_VALUE",
      `Expected "true" or "false" for ${source} parameter "${paramName}" but received "${raw}".`,
    );
  }

  return raw;
};

const buildHandlerInput = async (
  context: Context,
  endpoint: ContractEndpointJson,
): Promise<Record<string, unknown>> => {
  const input: Record<string, unknown> = {};

  const bodyParam = endpoint.params.find((param) => param.source === "body");
  const routeParams = endpoint.params.filter((param) => param.source === "route");
  const queryParams = endpoint.params.filter((param) => param.source === "query");
  const fileParams = endpoint.params.filter((param) => param.source === "file");
  const formFieldParams = endpoint.params.filter((param) => param.source === "formField");
  const usesFormBody =
    endpoint.isFormEncoded || fileParams.length > 0 || formFieldParams.length > 0;

  if (bodyParam || fileParams.length > 0 || formFieldParams.length > 0) {
    if (usesFormBody) {
      const parsedBody = await context.req.parseBody();

      if (fileParams.length > 0 || formFieldParams.length > 0) {
        const body: Record<string, unknown> = {};
        for (const param of [...fileParams, ...formFieldParams]) {
          const value = parsedBody[param.name];
          if (value === undefined) {
            if (isParamOptional(param)) {
              continue;
            }
            throw createBindingError(
              "MISSING_MULTIPART_FIELD",
              `Endpoint "${endpoint.name}" requires the multipart field "${param.name}" but it was absent from the request body.`,
            );
          }
          body[param.name] = value;
        }
        input.body = body;
      } else {
        input.body = parsedBody;
      }
    } else {
      try {
        input.body = await context.req.json();
      } catch {
        throw createBindingError(
          "INVALID_REQUEST_BODY",
          `Endpoint "${endpoint.name}" expected a JSON request body, but it could not be parsed.`,
        );
      }
    }
  }

  if (routeParams.length > 0) {
    const routeValues = context.req.param() as Record<string, string | undefined>;
    const params: Record<string, unknown> = {};
    for (const param of routeParams) {
      const raw = routeValues[param.name];
      if (raw === undefined) {
        if (isParamOptional(param)) {
          continue;
        }
        throw createBindingError(
          "MISSING_REQUIRED_PARAMETER",
          `Endpoint "${endpoint.name}" requires the route parameter "${param.name}".`,
        );
      }
      params[param.name] = coerceScalarParamValue(raw, param.type, param.name, "route");
    }
    input.params = params;
  }

  if (queryParams.length > 0) {
    const query: Record<string, unknown> = {};
    for (const param of queryParams) {
      const values = context.req.queries(param.name) ?? [];
      const [firstValue] = values;
      const resolved = unwrapNullableParamType(param.type);

      if (firstValue === undefined) {
        if (isParamOptional(param)) {
          continue;
        }
        throw createBindingError(
          "MISSING_REQUIRED_PARAMETER",
          `Endpoint "${endpoint.name}" requires the query parameter "${param.name}".`,
        );
      }

      if ("element" in resolved && resolved.kind === "array") {
        query[param.name] = values.map((value) =>
          coerceScalarParamValue(value, resolved.element, param.name, "query"),
        );
        continue;
      }

      if (values.length > 1) {
        throw createBindingError(
          "REPEATED_QUERY_PARAMETER",
          `Query parameter "${param.name}" was supplied ${values.length} times but endpoint "${endpoint.name}" declares it as a single value.`,
        );
      }

      query[param.name] = coerceScalarParamValue(firstValue, param.type, param.name, "query");
    }
    input.query = query;
  }

  return input;
};

// Fallback table for contracts whose responses carry no 2xx entry, shared with
// the lowerer, the type-level SuccessStatus, and the .NET extractor:
// POST -> 201; DELETE (void by construction when no 2xx exists) -> 204;
// everything else -> 200.
const getDefaultSuccessStatus = (httpMethod: string): number => {
  switch (httpMethod.toUpperCase()) {
    case "DELETE":
      return 204;
    case "POST":
      return 201;
    default:
      return 200;
  }
};

const getSuccessStatus = (endpoint: ContractEndpointJson): number => {
  const successResponse = endpoint.responses.find(
    (response) => response.statusCode >= 200 && response.statusCode < 300,
  );

  return successResponse?.statusCode ?? getDefaultSuccessStatus(endpoint.httpMethod);
};

const toResponseBody = (
  result: unknown,
): Blob | string | ArrayBuffer | Uint8Array | ReadableStream => {
  if (result instanceof Blob) {
    return result;
  }

  if (
    typeof result === "string" ||
    result instanceof ArrayBuffer ||
    result instanceof Uint8Array ||
    result instanceof ReadableStream
  ) {
    return result;
  }

  throw createHandlerResolutionError(
    `File response handlers must return Blob, string, ArrayBuffer, Uint8Array, or ReadableStream. Received ${typeof result}.`,
  );
};

const writeSuccessResponse = async (
  context: Context,
  endpoint: ContractEndpointJson,
  status: number,
  result: unknown,
): Promise<Response> => {
  if (result === undefined || isBodylessStatus(status)) {
    return context.body(null, status as 204);
  }

  if (endpoint.fileContentType) {
    return new Response(toResponseBody(result), {
      status,
      headers: { "content-type": endpoint.fileContentType },
    });
  }

  return context.json(result as object, status as 200);
};

const toHeaders = (headers: RivetHeadersInit): Headers => {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    for (const item of typeof value === "string" ? [value] : value) {
      result.append(name, item);
    }
  }
  return result;
};

/**
 * A contract result other than the success response. It is Hono's
 * `HTTPException`, so any Hono error handling recognises it. The route that
 * threw it answers with the JSON `data`, or no body when `data` is undefined;
 * `getResponse()` builds the same response outside a route.
 */
export class RivetHttpError<TData = unknown> extends HTTPException {
  public readonly data: TData;
  public readonly headers: RivetHeadersInit;

  public constructor(input: {
    status: ContentfulStatusCode;
    data: TData;
    headers?: RivetHeadersInit;
    message?: string;
  }) {
    // The type excludes 204/205/304, but a widened status can still reach here.
    if (input.data !== undefined && isBodylessStatus(input.status)) {
      throw new TypeError(`RivetHttpError status ${input.status} must not carry a body.`);
    }
    super(input.status, { message: input.message ?? `Rivet HTTP error ${input.status}` });
    this.name = "RivetHttpError";
    this.data = input.data;
    this.headers = input.headers ?? {};
  }

  // A Response body can be read once, so each call builds a fresh one.
  public override getResponse(): Response {
    const headers = toHeaders(this.headers);
    return this.data === undefined
      ? new Response(null, { status: this.status, headers })
      : Response.json(this.data, { status: this.status, headers });
  }
}

// Built through the context so headers set by middleware before `next()` stay.
const writeErrorResponse = (context: Context, error: RivetHttpError): Response =>
  error.data === undefined
    ? context.body(null, error.status, error.headers)
    : context.json(error.data, error.status, error.headers);

export const rivetHttpError = <TData>(
  status: ContentfulStatusCode,
  data: TData,
  options?: {
    headers?: RivetHeadersInit;
    message?: string;
  },
): RivetHttpError<TData> =>
  new RivetHttpError({
    status,
    data,
    headers: options?.headers,
    message: options?.message,
  });

/**
 * What registration needs of a Hono app. Structural because `Hono`'s `Env` is
 * invariant: no `Hono<…>` constraint accepts every app's `Bindings`/`Variables`,
 * and callers pass `TContract` explicitly, so `TApp` is not inferred.
 */
type HonoRouteTarget = {
  on(method: string, paths: string[], ...handlers: MiddlewareHandler[]): unknown;
};

export const registerRivetHonoRoutes = <TContract, TApp extends HonoRouteTarget = HonoRouteTarget>(
  app: TApp,
  contract: ContractJson,
  options: RegisterRivetHonoRoutesOptions<TContract>,
): TApp => {
  const selectedEndpoints = contract.endpoints.filter(
    (endpoint) => !options.group || endpoint.controllerName === options.group,
  );

  if (selectedEndpoints.length === 0) {
    throw createHandlerResolutionError(
      options.group
        ? `No endpoints were found for group "${options.group}".`
        : "No endpoints were found in the supplied contract.",
    );
  }

  type RouteEntry = HonoRouteEntry<TContract, ContractEndpointKey<TContract>>;
  // Object.entries cannot see through the per-key handler map type.
  const handlerEntries = (
    Object.entries(options.handlers) as [string, RouteEntry | undefined][]
  ).filter((entry): entry is [string, RouteEntry] => entry[1] !== undefined);
  const usedHandlerKeys = new Set<string>();
  const registeredRouteKeys = new Set<string>();

  for (const endpoint of selectedEndpoints) {
    const matchingEntries = handlerEntries.filter(
      ([key]) => key === endpoint.name || toLoweredEndpointName(key) === endpoint.name,
    );
    const [matchingEntry] = matchingEntries;

    if (matchingEntry === undefined) {
      throw createHandlerResolutionError(
        `No handler was provided for endpoint "${endpoint.name}".`,
      );
    }

    if (matchingEntries.length > 1) {
      throw createHandlerResolutionError(`Multiple handlers matched endpoint "${endpoint.name}".`);
    }

    const [matchedKey, routeEntry] = matchingEntry;

    // Without a group filter, several contracts' endpoints can share a name;
    // silently binding one handler to all of them hides real routing bugs.
    if (usedHandlerKeys.has(matchedKey)) {
      throw createHandlerResolutionError(
        `Handler "${matchedKey}" matched multiple endpoints named "${endpoint.name}". Pass "group" to scope registration to a single contract.`,
      );
    }

    usedHandlerKeys.add(matchedKey);

    const handlerEntry: HonoHandlerEntry<
      TContract,
      ContractEndpointKey<TContract>
    > = isRichHandlerEntry(routeEntry) ? routeEntry.handler : routeEntry;
    const middleware = isRichHandlerEntry(routeEntry) ? (routeEntry.middleware ?? []) : [];

    if (!options.resolveHandler && isHandlerClassToken(handlerEntry) && handlerEntry.length > 0) {
      throw createHandlerResolutionError(
        `Handler class "${handlerEntry.name || endpoint.name}" for endpoint "${endpoint.name}" requires constructor dependencies. Supply "resolveHandler" at registration.`,
      );
    }

    const status = getSuccessStatus(endpoint);
    const honoRoute = toHonoRoute(endpoint);

    const routeKey = `${endpoint.httpMethod.toUpperCase()} ${honoRoute}`;
    if (registeredRouteKeys.has(routeKey)) {
      throw createHandlerResolutionError(
        `Duplicate route registration: ${endpoint.httpMethod.toUpperCase()} ${endpoint.routeTemplate} is declared by multiple selected endpoints.`,
      );
    }
    registeredRouteKeys.add(routeKey);

    app.on(endpoint.httpMethod.toUpperCase(), [honoRoute], ...middleware, async (context) => {
      try {
        const handler = resolveHandlerEntry(
          endpoint.name,
          handlerEntry,
          options.resolveHandler,
          context,
        );
        const input = await buildHandlerInput(context, endpoint);
        const result = Object.keys(input).length > 0 ? await handler(input) : await handler();

        return await writeSuccessResponse(context, endpoint, status, result);
      } catch (error) {
        // Contract results answer from the route that threw them; anything
        // else reaches the app's onError.
        if (error instanceof RivetHttpError) {
          return writeErrorResponse(context, error);
        }
        throw error;
      }
    });
  }

  const unusedHandlerKeys = handlerEntries
    .map(([key]) => key)
    .filter((key) => !usedHandlerKeys.has(key));

  if (unusedHandlerKeys.length > 0) {
    throw createHandlerResolutionError(
      `Unused handlers were provided: ${unusedHandlerKeys.join(", ")}.`,
    );
  }

  return app;
};

export { asRivetHandler, type RivetHandlerOwner };
