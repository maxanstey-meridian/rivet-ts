import type { Endpoint } from "./authoring-types.js";

export type ContractEndpointKey<TContract> = {
  [TKey in keyof TContract]-?: TContract[TKey] extends Endpoint<any> ? TKey : never;
}[keyof TContract];

export type EndpointSpecOf<TContract, TKey extends ContractEndpointKey<TContract>> =
  TContract[TKey] extends Endpoint<infer TSpec> ? TSpec : never;

type RivetHandlerSuccessResponse<TSpec> = TSpec extends { readonly fileResponse: true }
  ? Blob
  : TSpec extends { readonly response: infer TResponse }
    ? TResponse
    : void;

export type RivetHandler<TContract, TKey extends ContractEndpointKey<TContract>> =
  EndpointSpecOf<TContract, TKey> extends { readonly input: infer TInput }
    ? (input: {
        readonly body: TInput;
      }) => Promise<RivetHandlerSuccessResponse<EndpointSpecOf<TContract, TKey>>>
    : () => Promise<RivetHandlerSuccessResponse<EndpointSpecOf<TContract, TKey>>>;

export const handle = <TContract, TKey extends ContractEndpointKey<TContract>>(
  handler: RivetHandler<TContract, TKey>,
): RivetHandler<TContract, TKey> => handler;
