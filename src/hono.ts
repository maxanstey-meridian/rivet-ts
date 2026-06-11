import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
  asRivetHandler,
  type ContractEndpointKey,
  type RivetHandler,
  type RivetHandlerOwner,
  type RivetHandlerOwnerWithInput,
} from "./domain/handler-types.js";

// Loose mirror of the lowered contract's RivetType shape — only the kinds the
// runtime coerces are modelled; everything else passes through as a string.
type ContractEndpointParamTypeJson = {
  readonly kind: string;
  readonly type?: string;
  readonly inner?: ContractEndpointParamTypeJson;
  readonly element?: ContractEndpointParamTypeJson;
};

type ContractEndpointParamJson = {
  readonly name: string;
  readonly source: string;
  readonly type?: ContractEndpointParamTypeJson;
  readonly isOptional?: boolean;
};

type ContractEndpointJson = {
  readonly name: string;
  readonly httpMethod: string;
  readonly routeTemplate: string;
  readonly group?: string;
  readonly controllerName?: string;
  readonly params: ReadonlyArray<ContractEndpointParamJson>;
  readonly responses: ReadonlyArray<{ readonly statusCode: number }>;
  readonly fileContentType?: string;
  readonly isFormEncoded?: boolean;
};

type ContractJson = {
  readonly endpoints: ReadonlyArray<ContractEndpointJson>;
};

type RivetHeadersInit = Record<string, string | string[]>;

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export type RivetInvokable<
  TContract,
  TKey extends ContractEndpointKey<TContract>,
> = RivetHandlerOwnerWithInput<TContract, TKey>;

export type RivetInvokableClass<TContract, TKey extends ContractEndpointKey<TContract>> = new (
  ...args: any[]
) => RivetInvokable<TContract, TKey>;

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
    Handler: new (...args: any[]) => THandler,
    context: Context,
  ) => THandler;
};

const toHonoRoute = (routeTemplate: string): string => routeTemplate.replace(/\{([^}]+)\}/g, ":$1");

const toRuntimeEndpointName = (value: string): string => {
  if (value.length === 0) {
    return value;
  }

  return `${value[0]?.toLowerCase() ?? ""}${value.slice(1)}`;
};

const isHandlerClassToken = (value: unknown): value is new (...args: any[]) => unknown => {
  if (typeof value !== "function") {
    return false;
  }

  const prototype = value.prototype as { handle?: unknown; invoke?: unknown } | undefined;
  return typeof prototype?.handle === "function" || typeof prototype?.invoke === "function";
};

const isPlainHandlerFunction = (value: unknown): value is (...args: any[]) => Promise<unknown> =>
  typeof value === "function" && !isHandlerClassToken(value);

const isRichHandlerEntry = <TContract, TKey extends ContractEndpointKey<TContract>>(
  value: unknown,
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
): RivetHandler<TContract, TKey> => {
  if (isPlainHandlerFunction(handlerEntry)) {
    return handlerEntry as RivetHandler<TContract, TKey>;
  }

  if (!isHandlerClassToken(handlerEntry)) {
    throw createHandlerResolutionError(
      `Handler for endpoint "${endpointName}" must be a plain function or a class with a prototype "handle" or "invoke" method.`,
    );
  }

  if (resolveHandler) {
    return asRivetHandler(
      resolveHandler(handlerEntry, context) as RivetInvokable<TContract, TKey>,
    ) as RivetHandler<TContract, TKey>;
  }

  if (handlerEntry.length > 0) {
    throw createHandlerResolutionError(
      `Handler class "${handlerEntry.name || endpointName}" for endpoint "${endpointName}" requires constructor dependencies. Supply "resolveHandler" at registration.`,
    );
  }

  return asRivetHandler(new handlerEntry() as RivetInvokable<TContract, TKey>) as RivetHandler<
    TContract,
    TKey
  >;
};

const normalizeRouteEntry = <TContract, TKey extends ContractEndpointKey<TContract>>(
  endpointName: string,
  routeEntry: HonoRouteEntry<TContract, TKey>,
): {
  readonly handlerEntry: HonoHandlerEntry<TContract, TKey>;
  readonly middleware: ReadonlyArray<MiddlewareHandler>;
} => {
  if (!isRichHandlerEntry<TContract, TKey>(routeEntry)) {
    return {
      handlerEntry: routeEntry,
      middleware: [],
    };
  }

  const middleware = routeEntry.middleware ?? [];
  if (!Array.isArray(middleware)) {
    throw createHandlerResolutionError(
      `Middleware for endpoint "${endpointName}" must be an array of Hono middleware handlers.`,
    );
  }

  return {
    handlerEntry: routeEntry.handler,
    middleware,
  };
};

// Request-binding failures surface as structured 400s through the same
// RivetHttpError path handlers use, so the error envelope is uniform:
// { code, message } — matching the diagnostic vocabulary used elsewhere.
const createBindingError = (code: string, message: string): RivetHttpError<unknown> =>
  rivetHttpError(400, { code, message });

const unwrapNullableParamType = (
  type: ContractEndpointParamTypeJson | undefined,
): ContractEndpointParamTypeJson | undefined =>
  type?.kind === "nullable" ? unwrapNullableParamType(type.inner) : type;

const isParamOptional = (param: ContractEndpointParamJson): boolean =>
  param.isOptional === true || param.type?.kind === "nullable";

// Coerces a raw string value to the contract-declared param type. Only
// number/boolean primitives (and intUnion, which is numeric on the wire) are
// coerced; strings, enums, and unknown kinds pass through unchanged.
const coerceScalarParamValue = (
  raw: string,
  type: ContractEndpointParamTypeJson | undefined,
  paramName: string,
  source: string,
): unknown => {
  const resolved = unwrapNullableParamType(type);

  if (
    resolved?.kind === "intUnion" ||
    (resolved?.kind === "primitive" && resolved.type === "number")
  ) {
    const value = raw.trim() === "" ? Number.NaN : Number(raw);
    if (Number.isNaN(value)) {
      throw createBindingError(
        "INVALID_PARAMETER_VALUE",
        `Expected a number for ${source} parameter "${paramName}" but received "${raw}".`,
      );
    }
    return value;
  }

  if (resolved?.kind === "primitive" && resolved.type === "boolean") {
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
      const resolved = unwrapNullableParamType(param.type);

      if (values.length === 0) {
        if (isParamOptional(param)) {
          continue;
        }
        throw createBindingError(
          "MISSING_REQUIRED_PARAMETER",
          `Endpoint "${endpoint.name}" requires the query parameter "${param.name}".`,
        );
      }

      if (resolved?.kind === "array") {
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

      query[param.name] = coerceScalarParamValue(values[0]!, param.type, param.name, "query");
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

const withHeaders = (
  input: Headers | Record<string, string> | undefined,
  name: string,
  value: string,
): Headers => {
  const headers = new Headers(input);
  headers.set(name, value);
  return headers;
};

const toResponseBody = async (
  result: unknown,
  _fileContentType: string,
): Promise<Blob | string | ArrayBuffer | Uint8Array | ReadableStream> => {
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
  if (result === undefined || status === 204 || status === 205 || status === 304) {
    return context.body(null, status as 204);
  }

  if (endpoint.fileContentType) {
    return new Response(await toResponseBody(result, endpoint.fileContentType), {
      status,
      headers: withHeaders(undefined, "content-type", endpoint.fileContentType),
    });
  }

  return context.json(result as object, status as 200);
};

export class RivetHttpError<TData = unknown> extends Error {
  public readonly status: number;
  public readonly data: TData;
  public readonly headers?: RivetHeadersInit;

  public constructor(input: {
    status: number;
    data: TData;
    headers?: RivetHeadersInit;
    message?: string;
  }) {
    // 204/205/304 forbid response bodies; serializing data would emit an
    // invalid response, so reject loudly at the call site instead of
    // silently dropping the payload.
    if (
      (input.status === 204 || input.status === 205 || input.status === 304) &&
      input.data !== undefined
    ) {
      throw new Error(
        `RivetHttpError status ${input.status} must not carry a body. Pass undefined data for body-forbidding statuses.`,
      );
    }

    super(input.message ?? `Rivet HTTP error ${input.status}`);
    this.name = "RivetHttpError";
    this.status = input.status;
    this.data = input.data;
    this.headers = input.headers;
  }
}

export const rivetHttpError = <TData>(
  status: number,
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

export const registerRivetHonoRoutes = <
  TContract,
  TApp extends Hono<any, any, any> = Hono<any, any, any>,
>(
  app: TApp,
  contract: ContractJson,
  options: RegisterRivetHonoRoutesOptions<TContract>,
): TApp => {
  const selectedEndpoints = contract.endpoints.filter(
    (endpoint) =>
      !options.group ||
      endpoint.group === options.group ||
      endpoint.controllerName === options.group,
  );

  if (selectedEndpoints.length === 0) {
    throw createHandlerResolutionError(
      options.group
        ? `No endpoints were found for group "${options.group}".`
        : "No endpoints were found in the supplied contract.",
    );
  }

  const handlerEntries = Object.entries(options.handlers as Record<string, unknown>);
  const usedHandlerKeys = new Set<string>();
  const registeredRouteKeys = new Set<string>();

  for (const endpoint of selectedEndpoints) {
    const matchingEntries = handlerEntries.filter(
      ([key]) => key === endpoint.name || toRuntimeEndpointName(key) === endpoint.name,
    );

    if (matchingEntries.length === 0) {
      throw createHandlerResolutionError(
        `No handler was provided for endpoint "${endpoint.name}".`,
      );
    }

    if (matchingEntries.length > 1) {
      throw createHandlerResolutionError(`Multiple handlers matched endpoint "${endpoint.name}".`);
    }

    const [matchedKey, routeEntry] = matchingEntries[0]!;

    // Without a group filter, several contracts' endpoints can share a name;
    // silently binding one handler to all of them hides real routing bugs.
    if (usedHandlerKeys.has(matchedKey)) {
      throw createHandlerResolutionError(
        `Handler "${matchedKey}" matched multiple endpoints named "${endpoint.name}". Pass "group" to scope registration to a single contract.`,
      );
    }

    usedHandlerKeys.add(matchedKey);

    const { handlerEntry, middleware } = normalizeRouteEntry(
      endpoint.name,
      routeEntry as HonoRouteEntry<TContract, ContractEndpointKey<TContract>>,
    );

    if (!options.resolveHandler && isHandlerClassToken(handlerEntry) && handlerEntry.length > 0) {
      throw createHandlerResolutionError(
        `Handler class "${handlerEntry.name || endpoint.name}" for endpoint "${endpoint.name}" requires constructor dependencies. Supply "resolveHandler" at registration.`,
      );
    }

    const method = endpoint.httpMethod.toLowerCase() as HttpMethod;
    const status = getSuccessStatus(endpoint);
    const honoRoute = toHonoRoute(endpoint.routeTemplate);

    const routeKey = `${method} ${honoRoute}`;
    if (registeredRouteKeys.has(routeKey)) {
      throw createHandlerResolutionError(
        `Duplicate route registration: ${endpoint.httpMethod.toUpperCase()} ${endpoint.routeTemplate} is declared by multiple selected endpoints.`,
      );
    }
    registeredRouteKeys.add(routeKey);
    const routeHandlers: MiddlewareHandler[] = [
      ...middleware,
      async (context) => {
        try {
          const handler = resolveHandlerEntry(
            endpoint.name,
            handlerEntry as HonoHandlerEntry<TContract, ContractEndpointKey<TContract>>,
            options.resolveHandler,
            context,
          );
          const input = await buildHandlerInput(context, endpoint);
          const result =
            Object.keys(input).length > 0
              ? await (handler as (input: unknown) => Promise<unknown>)(input)
              : await (handler as () => Promise<unknown>)();

          return await writeSuccessResponse(context, endpoint, status, result);
        } catch (error) {
          if (error instanceof RivetHttpError) {
            const { data, headers } = error;

            if (
              data === undefined ||
              error.status === 204 ||
              error.status === 205 ||
              error.status === 304
            ) {
              return context.body(null, error.status as 204, headers);
            }

            return context.json(data as object, error.status as 200, headers);
          }
          throw error;
        }
      },
    ];

    (app[method] as (path: string, ...handlers: MiddlewareHandler[]) => unknown)(
      honoRoute,
      ...routeHandlers,
    );
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
