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

type HandlerInputBag<TSpec> =
  (TSpec extends { readonly input: infer T } ? { readonly body: T } : unknown) &
  (TSpec extends { readonly params: infer T } ? { readonly params: T } : unknown) &
  (TSpec extends { readonly query: infer T } ? { readonly query: T } : unknown);

export type RivetHandler<TContract, TKey extends ContractEndpointKey<TContract>> =
  [keyof HandlerInputBag<EndpointSpecOf<TContract, TKey>>] extends [never]
    ? () => Promise<RivetHandlerSuccessResponse<EndpointSpecOf<TContract, TKey>>>
    : (input: HandlerInputBag<EndpointSpecOf<TContract, TKey>>) =>
        Promise<RivetHandlerSuccessResponse<EndpointSpecOf<TContract, TKey>>>;
