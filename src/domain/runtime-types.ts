import type { ContractEndpointKey, EndpointSpecOf, RivetHandler } from "./handler-types.js";

export type RivetResult<TData> = {
  readonly status: number;
  readonly data: TData;
};

type SuccessResponseType<TSpec> = TSpec extends { readonly fileResponse: true }
  ? Blob
  : TSpec extends { readonly response: infer TResponse }
    ? TResponse
    : void;

type SuccessStatus<TSpec> = TSpec extends { readonly successStatus: infer S extends number }
  ? S
  : 200;

export type RivetSuccessResult<
  TContract,
  TKey extends ContractEndpointKey<TContract>,
> = {
  readonly status: SuccessStatus<EndpointSpecOf<TContract, TKey>>;
  readonly data: SuccessResponseType<EndpointSpecOf<TContract, TKey>>;
};

type ErrorResultEntry<TError> = TError extends {
  readonly status: infer S extends number;
  readonly response: infer R;
}
  ? { readonly status: S; readonly data: R }
  : TError extends { readonly status: infer S extends number }
    ? { readonly status: S; readonly data: undefined }
    : never;

export type RivetErrorResultUnion<TSpec> = TSpec extends {
  readonly errors: infer TErrors extends readonly unknown[];
}
  ? ErrorResultEntry<TErrors[number]>
  : never;

export type RivetEndpointResult<
  TContract,
  TKey extends ContractEndpointKey<TContract>,
> = RivetSuccessResult<TContract, TKey> | RivetErrorResultUnion<EndpointSpecOf<TContract, TKey>>;

export type RivetHandlerMap<TContract> = {
  readonly [K in ContractEndpointKey<TContract>]: RivetHandler<TContract, K>;
};

export type EndpointMetaMap<TContract> = {
  readonly [K in ContractEndpointKey<TContract>]?: {
    readonly successStatus?: number;
  };
};

const RIVET_META_KEY = "__rivetMeta";

export const defineHandlers =
  <TContract>() =>
  <THandlers extends RivetHandlerMap<TContract>>(
    handlers: THandlers &
      Record<Exclude<keyof THandlers, ContractEndpointKey<TContract>>, never>,
    meta?: EndpointMetaMap<TContract>,
  ): THandlers => {
    if (meta) {
      Object.defineProperty(handlers, RIVET_META_KEY, {
        value: meta,
        enumerable: false,
      });
    }
    return handlers;
  };

type UnwrapFalseOption = { readonly unwrap: false };

export type DirectClientMethod<
  TContract,
  TKey extends ContractEndpointKey<TContract>,
> = EndpointSpecOf<TContract, TKey> extends { readonly input: infer TInput }
  ? ((input: TInput) => Promise<SuccessResponseType<EndpointSpecOf<TContract, TKey>>>) &
      ((input: TInput, options: UnwrapFalseOption) => Promise<RivetEndpointResult<TContract, TKey>>)
  : (() => Promise<SuccessResponseType<EndpointSpecOf<TContract, TKey>>>) &
      ((options: UnwrapFalseOption) => Promise<RivetEndpointResult<TContract, TKey>>);

export type DirectClient<TContract> = {
  readonly [K in ContractEndpointKey<TContract>]: DirectClientMethod<TContract, K>;
};

const isUnwrapFalseOption = (value: unknown): value is UnwrapFalseOption =>
  typeof value === "object" &&
  value !== null &&
  "unwrap" in value &&
  (value as Record<string, unknown>).unwrap === false;

export const createDirectClient = <TContract>(
  handlers: RivetHandlerMap<TContract>,
): DirectClient<TContract> => {
  const meta = (handlers as Record<string, unknown>)[RIVET_META_KEY] as
    | Record<string, { successStatus?: number }>
    | undefined;
  return new Proxy({} as DirectClient<TContract>, {
    get(_, key) {
      if (typeof key !== "string") {
        return undefined;
      }
      const handler = (handlers as Record<string, (...args: readonly unknown[]) => unknown>)[key];
      if (!handler) {
        return undefined;
      }
      return (...args: unknown[]) => {
        const lastArg = args.at(-1);
        const unwrapFalse = isUnwrapFalseOption(lastArg);
        const input = unwrapFalse
          ? args.length > 1 ? args[0] : undefined
          : args[0];
        const call = () => {
          if (input !== undefined) {
            return handler({ body: input });
          }
          return handler();
        };
        if (!unwrapFalse) {
          return call();
        }
        const successStatus = meta?.[key]?.successStatus ?? 200;
        return (call() as Promise<unknown>).then(
          (result) => ({ status: successStatus, data: result }),
          (error: unknown) => {
            if (error instanceof RivetError) {
              return error.result;
            }
            throw error;
          },
        );
      };
    },
  });
};

export class RivetError extends Error {
  public readonly result: RivetResult<unknown>;

  constructor(result: RivetResult<unknown>) {
    super("RivetError");
    this.result = result;
  }
}
