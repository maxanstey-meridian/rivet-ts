import type { Endpoint } from "./authoring-types.js";

export type ContractEndpointKey<TContract> = {
  [TKey in keyof TContract]-?: TContract[TKey] extends Endpoint<any> ? TKey : never;
}[keyof TContract];

/** The lowered contract endpoint `name` for an authored endpoint key. */
export const toLoweredEndpointName = (key: string): string =>
  `${key.charAt(0).toLowerCase()}${key.slice(1)}`;

export type EndpointSpecOf<TContract, TKey extends ContractEndpointKey<TContract>> =
  TContract[TKey] extends Endpoint<infer TSpec> ? TSpec : never;

type RivetHandlerSuccessResponse<TSpec> = TSpec extends { readonly fileResponse: true }
  ? Blob
  : TSpec extends { readonly response: infer TResponse }
    ? TResponse
    : void;

// The handler input mirrors the params the lowerer writes (endpoint-lowering.ts)
// and the Hono adapter delivers: `route` params under `params`, `query` params
// under `query`, and the body (JSON, form or multipart fields) under `body`.
// The lowerer matches input keys to `{placeholder}`s case-insensitively.

// Mirrors the lowerer's BODY_HTTP_METHODS gate.
type BodyAuthoringHttpMethod = "PATCH" | "POST" | "PUT";

type RoutePlaceholders<TRoute> = TRoute extends `${string}{${infer TName}}${infer TRest}`
  ? TName | RoutePlaceholders<TRest>
  : never;

type RouteKeysOf<T, TPlaceholder extends string> = {
  [TKey in keyof T]-?: TKey extends string
    ? Lowercase<TKey> extends Lowercase<TPlaceholder>
      ? TKey
      : never
    : never;
}[keyof T];

type UncoveredPlaceholders<TPlaceholder extends string, TKeys> = TPlaceholder extends unknown
  ? Lowercase<TPlaceholder> extends Lowercase<TKeys & string>
    ? never
    : TPlaceholder
  : never;

type Flatten<T> = { [TKey in keyof T]: T[TKey] };

/** A string param per placeholder that no key of `TDeclared` names. */
type StringParams<TPlaceholder extends string, TDeclared> = {
  readonly [TName in UncoveredPlaceholders<TPlaceholder, keyof TDeclared>]: string;
};

/** `{ [name]: T }`, or nothing when `T` has no keys (the adapter then omits the slot). */
type Slot<TName extends string, T> = [keyof T] extends [never]
  ? unknown
  : { readonly [TKey in TName]: Flatten<T> };

/** A spec key's type, or `{}` when the spec does not declare it. */
type SpecValue<TSpec, TKey extends "input" | "params" | "query"> = TSpec extends {
  readonly [TName in TKey]: infer T;
}
  ? T
  : {};

// Any declared input is a body param, even `{}`, so this slot keys off the declaration.
type BodySlot<TSpec> = TSpec extends { readonly input: infer T } ? { readonly body: T } : unknown;

/** A body method appends every placeholder, typed from the input key naming it. */
type PlaceholderParams<TInput, TPlaceholder extends string> = {
  readonly [TName in TPlaceholder]: [RouteKeysOf<TInput, TName>] extends [never]
    ? string
    : Exclude<TInput[RouteKeysOf<TInput, TName>], undefined>;
};

type ExplicitInputBag<TSpec, TPlaceholder extends string> = Slot<
  "params",
  SpecValue<TSpec, "params"> & StringParams<TPlaceholder, SpecValue<TSpec, "params">>
> &
  Slot<"query", SpecValue<TSpec, "query">> &
  BodySlot<TSpec>;

type MultipartInputBag<TInput, TRouteKey extends keyof TInput> = Slot<
  "params",
  Pick<TInput, TRouteKey>
> & { readonly body: Flatten<Omit<TInput, TRouteKey>> };

type BodylessInputBag<TInput, TPlaceholder extends string, TRouteKey extends keyof TInput> = Slot<
  "params",
  Pick<TInput, TRouteKey> & StringParams<TPlaceholder, Pick<TInput, TRouteKey>>
> &
  Slot<"query", Omit<TInput, TRouteKey>>;

type HandlerInputBag<
  TSpec,
  TPlaceholder extends string = RoutePlaceholders<
    TSpec extends { readonly route: infer TRoute } ? TRoute : never
  >,
  TInput = SpecValue<TSpec, "input">,
> = TSpec extends { readonly params: unknown } | { readonly query: unknown }
  ? ExplicitInputBag<TSpec, TPlaceholder>
  : TSpec extends { readonly method: BodyAuthoringHttpMethod }
    ? TSpec extends { readonly acceptsFile: true; readonly input: unknown }
      ? MultipartInputBag<TInput, RouteKeysOf<TInput, TPlaceholder>>
      : Slot<"params", PlaceholderParams<TInput, TPlaceholder>> & BodySlot<TSpec>
    : BodylessInputBag<TInput, TPlaceholder, RouteKeysOf<TInput, TPlaceholder>>;

export type RivetHandlerInput<TContract, TKey extends ContractEndpointKey<TContract>> = [
  keyof HandlerInputBag<EndpointSpecOf<TContract, TKey>>,
] extends [never]
  ? {}
  : Flatten<HandlerInputBag<EndpointSpecOf<TContract, TKey>>>;

export type RivetHandlerResult<
  TContract,
  TKey extends ContractEndpointKey<TContract>,
> = RivetHandlerSuccessResponse<EndpointSpecOf<TContract, TKey>>;

export type RivetHandler<TContract, TKey extends ContractEndpointKey<TContract>> = [
  keyof RivetHandlerInput<TContract, TKey>,
] extends [never]
  ? () => Promise<RivetHandlerResult<TContract, TKey>>
  : (input: RivetHandlerInput<TContract, TKey>) => Promise<RivetHandlerResult<TContract, TKey>>;

export type RivetInvokableHandler<
  TContract,
  TKey extends ContractEndpointKey<TContract>,
  TInput extends RivetHandlerInput<TContract, TKey> = RivetHandlerInput<TContract, TKey>,
> = [keyof TInput] extends [never]
  ? () => Promise<RivetHandlerResult<TContract, TKey>>
  : (input: TInput) => Promise<RivetHandlerResult<TContract, TKey>>;

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
