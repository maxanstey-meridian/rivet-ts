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

export const defineHandlers =
  <TContract>() =>
  <THandlers extends RivetHandlerMap<TContract>>(
    handlers: THandlers &
      Record<Exclude<keyof THandlers, ContractEndpointKey<TContract>>, never>,
  ): THandlers =>
    handlers;

export class RivetError extends Error {
  public readonly result: RivetResult<unknown>;

  constructor(result: RivetResult<unknown>) {
    super("RivetError");
    this.result = result;
  }
}
