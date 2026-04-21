import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
  asRivetHandler,
  type ContractEndpointKey,
  type RivetHandler,
  type RivetHandlerOwner,
  type RivetHandlerOwnerWithInput,
} from "./domain/handler-types.js";

type ContractEndpointParamJson = {
  readonly name: string;
  readonly source: string;
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
          body[param.name] = parsedBody[param.name];
        }
        input.body = body;
      } else {
        input.body = parsedBody;
      }
    } else {
      input.body = await context.req.json();
    }
  }

  if (routeParams.length > 0) {
    input.params = context.req.param();
  }

  if (queryParams.length > 0) {
    const query: Record<string, string | undefined> = {};
    for (const param of queryParams) {
      query[param.name] = context.req.query(param.name);
    }
    input.query = query;
  }

  return input;
};

const getSuccessStatus = (responses: readonly { readonly statusCode: number }[]): number => {
  const successResponse = responses.find(
    (response) => response.statusCode >= 200 && response.statusCode < 300,
  );

  return successResponse?.statusCode ?? 200;
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
    const status = getSuccessStatus(endpoint.responses);
    const honoRoute = toHonoRoute(endpoint.routeTemplate);
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
