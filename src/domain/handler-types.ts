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

type HandlerInputBag<TSpec> = (TSpec extends { readonly input: infer T }
  ? { readonly body: T }
  : unknown) &
  (TSpec extends { readonly params: infer T } ? { readonly params: T } : unknown) &
  (TSpec extends { readonly query: infer T } ? { readonly query: T } : unknown);

export type RivetHandlerInput<TContract, TKey extends ContractEndpointKey<TContract>> = [
  keyof HandlerInputBag<EndpointSpecOf<TContract, TKey>>,
] extends [never]
  ? {}
  : HandlerInputBag<EndpointSpecOf<TContract, TKey>>;

export type RivetHandler<TContract, TKey extends ContractEndpointKey<TContract>> = [
  keyof RivetHandlerInput<TContract, TKey>,
] extends [never]
  ? () => Promise<RivetHandlerSuccessResponse<EndpointSpecOf<TContract, TKey>>>
  : (
      input: RivetHandlerInput<TContract, TKey>,
    ) => Promise<RivetHandlerSuccessResponse<EndpointSpecOf<TContract, TKey>>>;

export type RivetInvokableHandler<
  TContract,
  TKey extends ContractEndpointKey<TContract>,
  TInput extends RivetHandlerInput<TContract, TKey> = RivetHandlerInput<TContract, TKey>,
> = [keyof TInput] extends [never]
  ? () => Promise<RivetHandlerSuccessResponse<EndpointSpecOf<TContract, TKey>>>
  : (input: TInput) => Promise<RivetHandlerSuccessResponse<EndpointSpecOf<TContract, TKey>>>;

export type RivetHandlerOwner<
  TContract,
  TKey extends ContractEndpointKey<TContract>,
  TInput extends RivetHandlerInput<TContract, TKey> = RivetHandlerInput<TContract, TKey>,
> = RivetHandlerOwnerWithInput<TContract, TKey, TInput>;

export type RivetHandlerOwnerWithInput<
  TContract,
  TKey extends ContractEndpointKey<TContract>,
  TInput extends RivetHandlerInput<TContract, TKey> = RivetHandlerInput<TContract, TKey>,
> = {
  handle?: RivetInvokableHandler<TContract, TKey, TInput>;
  invoke?: RivetInvokableHandler<TContract, TKey, TInput>;
};

export const asRivetHandler = <
  TContract,
  TKey extends ContractEndpointKey<TContract>,
  TInput extends RivetHandlerInput<TContract, TKey> = RivetHandlerInput<TContract, TKey>,
>(
  handlerOwner: RivetHandlerOwnerWithInput<TContract, TKey, TInput>,
): RivetInvokableHandler<TContract, TKey, TInput> => {
  const handle =
    "handle" in handlerOwner && typeof handlerOwner.handle === "function"
      ? handlerOwner.handle
      : undefined;
  const invoke =
    "invoke" in handlerOwner && typeof handlerOwner.invoke === "function"
      ? handlerOwner.invoke
      : undefined;

  if (handle && invoke) {
    throw new Error(
      'asRivetHandler expected exactly one handler method. Found both "handle" and "invoke".',
    );
  }

  if (handle) {
    return handle.bind(handlerOwner) as RivetInvokableHandler<TContract, TKey, TInput>;
  }

  if (invoke) {
    return invoke.bind(handlerOwner) as RivetInvokableHandler<TContract, TKey, TInput>;
  }

  throw new Error('asRivetHandler expected a "handle" or "invoke" method.');
};
