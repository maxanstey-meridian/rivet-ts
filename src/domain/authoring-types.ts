export type Contract<TName extends string> = {
  readonly __contractName?: TName;
};

export type EndpointAuthoringHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * The registered 2xx statuses: exactly Hono's `SuccessStatusCode` (a type test
 * pins it), so the runtime can send each.
 */
export type EndpointAuthoringSuccessStatus =
  | 200
  | 201
  | 202
  | 203
  | 204
  | 205
  | 206
  | 207
  | 208
  | 226;

export type EndpointErrorAuthoringSpec = {
  readonly status: number;
  readonly response?: unknown;
  readonly description?: string;
};

export type EndpointSecurityAuthoringSpec = {
  readonly scheme: string;
};

export type EndpointExampleAuthoringScalar = string | number | boolean | null;

export type EndpointExampleAuthoringValue =
  | EndpointExampleAuthoringScalar
  | readonly EndpointExampleAuthoringValue[]
  | {
      readonly [key: string]: EndpointExampleAuthoringValue;
    };

export type EndpointExampleAuthoringReference<TExample = EndpointExampleAuthoringValue> =
  TExample extends EndpointExampleAuthoringScalar
    ? TExample
    : TExample extends readonly (infer TItem)[]
      ? readonly EndpointExampleAuthoringReference<TItem>[]
      : TExample extends (...args: readonly never[]) => unknown
        ? never
        : TExample extends object
          ? {
              readonly [TKey in keyof TExample]: EndpointExampleAuthoringReference<TExample[TKey]>;
            }
          : never;

export type EndpointRequestExampleAuthoringDescriptor = {
  readonly name?: string;
  readonly mediaType?: string;
};

export type InlineEndpointRequestExampleAuthoringSpec<TExample = EndpointExampleAuthoringValue> =
  EndpointRequestExampleAuthoringDescriptor & {
    readonly json: EndpointExampleAuthoringReference<TExample>;
  };

export type RefEndpointRequestExampleAuthoringSpec<TExample = EndpointExampleAuthoringValue> =
  EndpointRequestExampleAuthoringDescriptor & {
    readonly componentExampleId: string;
    readonly resolvedJson: EndpointExampleAuthoringReference<TExample>;
  };

export type EndpointRequestExampleAuthoringSpec<TExample = EndpointExampleAuthoringValue> =
  | InlineEndpointRequestExampleAuthoringSpec<TExample>
  | RefEndpointRequestExampleAuthoringSpec<TExample>;

export type EndpointResponseExamplesAuthoringSpec<TExample = EndpointExampleAuthoringValue> = {
  readonly status: number;
  readonly examples: readonly (
    | EndpointExampleAuthoringReference<TExample>
    | EndpointRequestExampleAuthoringSpec<TExample>
  )[];
};

export type EndpointAuthoringSpec = {
  readonly method: EndpointAuthoringHttpMethod;
  readonly route: string;
  readonly input?: unknown;
  readonly params?: unknown;
  readonly query?: unknown;
  readonly response?: unknown;
  readonly requestExample?: EndpointExampleAuthoringReference;
  readonly requestExamples?: readonly (
    | EndpointExampleAuthoringReference
    | EndpointRequestExampleAuthoringSpec
  )[];
  readonly successResponseExample?: EndpointExampleAuthoringReference;
  readonly responseExamples?: readonly EndpointResponseExamplesAuthoringSpec[];
  readonly successStatus?: EndpointAuthoringSuccessStatus;
  readonly summary?: string;
  readonly description?: string;
  readonly errors?: readonly EndpointErrorAuthoringSpec[];
  readonly anonymous?: boolean;
  readonly security?: EndpointSecurityAuthoringSpec;
  readonly fileResponse?: boolean;
  readonly fileContentType?: string;
  readonly queryAuth?: string | true;
  readonly formEncoded?: boolean;
  readonly acceptsFile?: boolean;
};

type ExactAuthoringShape<TActual, TShape> = TShape & {
  readonly [TKey in Exclude<keyof TActual, keyof TShape>]: never;
};

type ExactEndpointSecurityAuthoringSpec<TSpec extends EndpointSecurityAuthoringSpec> =
  ExactAuthoringShape<TSpec, EndpointSecurityAuthoringSpec>;

type ExactEndpointErrorAuthoringSpec<TSpec extends EndpointErrorAuthoringSpec> =
  ExactAuthoringShape<TSpec, EndpointErrorAuthoringSpec>;

type ExactEndpointErrorAuthoringTuple<TErrors> = TErrors extends readonly unknown[]
  ? {
      readonly [TIndex in keyof TErrors]: TErrors[TIndex] extends EndpointErrorAuthoringSpec
        ? ExactEndpointErrorAuthoringSpec<TErrors[TIndex]>
        : TErrors[TIndex];
    }
  : TErrors;

type EndpointRequestExampleAuthoringReference<TSpec extends EndpointAuthoringSpec> =
  "input" extends keyof TSpec ? EndpointExampleAuthoringReference<TSpec["input"]> : never;

type EndpointRequestExamplesAuthoringEntry<TSpec extends EndpointAuthoringSpec> =
  | EndpointRequestExampleAuthoringReference<TSpec>
  | EndpointRequestExampleAuthoringSpec<"input" extends keyof TSpec ? TSpec["input"] : never>;

type ExactEndpointRequestExamplesAuthoringEntry<TSpec extends EndpointAuthoringSpec, TEntry> =
  TEntry extends RefEndpointRequestExampleAuthoringSpec<unknown>
    ? ExactAuthoringShape<
        TEntry,
        RefEndpointRequestExampleAuthoringSpec<"input" extends keyof TSpec ? TSpec["input"] : never>
      >
    : TEntry extends InlineEndpointRequestExampleAuthoringSpec<unknown>
      ? ExactAuthoringShape<
          TEntry,
          InlineEndpointRequestExampleAuthoringSpec<
            "input" extends keyof TSpec ? TSpec["input"] : never
          >
        >
      : TEntry extends EndpointRequestExamplesAuthoringEntry<TSpec>
        ? EndpointRequestExamplesAuthoringEntry<TSpec>
        : TEntry;

type ExactEndpointRequestExamplesAuthoringTuple<
  TSpec extends EndpointAuthoringSpec,
  TExamples,
> = TExamples extends readonly unknown[]
  ? {
      readonly [TIndex in keyof TExamples]: ExactEndpointRequestExamplesAuthoringEntry<
        TSpec,
        TExamples[TIndex]
      >;
    }
  : TExamples;

type EndpointSuccessResponseExampleAuthoringReference<TSpec extends EndpointAuthoringSpec> =
  "response" extends keyof TSpec
    ? [TSpec["response"]] extends [void]
      ? never
      : EndpointExampleAuthoringReference<TSpec["response"]>
    : never;

type ExactEndpointResponseExamplesAuthoringTuple<
  _TSpec extends EndpointAuthoringSpec,
  TExamples,
> = TExamples extends readonly unknown[]
  ? {
      readonly [TIndex in keyof TExamples]: TExamples[TIndex] extends EndpointResponseExamplesAuthoringSpec
        ? EndpointResponseExamplesAuthoringSpec
        : TExamples[TIndex];
    }
  : TExamples;

type HasSpecificEndpointExampleAuthoringReference<
  TSpec extends EndpointAuthoringSpec,
  TKey extends "requestExample" | "requestExamples" | "successResponseExample" | "responseExamples",
> = EndpointAuthoringSpec[TKey] extends TSpec[TKey] ? false : true;

type ExactEndpointAuthoringSpec<TSpec extends EndpointAuthoringSpec> = ExactAuthoringShape<
  TSpec,
  EndpointAuthoringSpec
> & {
  readonly errors?: ExactEndpointErrorAuthoringTuple<TSpec["errors"]>;
  readonly requestExample?: HasSpecificEndpointExampleAuthoringReference<
    TSpec,
    "requestExample"
  > extends true
    ? EndpointRequestExampleAuthoringReference<TSpec>
    : TSpec["requestExample"];
  readonly requestExamples?: HasSpecificEndpointExampleAuthoringReference<
    TSpec,
    "requestExamples"
  > extends true
    ? ExactEndpointRequestExamplesAuthoringTuple<TSpec, TSpec["requestExamples"]>
    : TSpec["requestExamples"];
  readonly security?: TSpec["security"] extends EndpointSecurityAuthoringSpec
    ? ExactEndpointSecurityAuthoringSpec<TSpec["security"]>
    : TSpec["security"];
  readonly successResponseExample?: HasSpecificEndpointExampleAuthoringReference<
    TSpec,
    "successResponseExample"
  > extends true
    ? EndpointSuccessResponseExampleAuthoringReference<TSpec>
    : TSpec["successResponseExample"];
  readonly responseExamples?: HasSpecificEndpointExampleAuthoringReference<
    TSpec,
    "responseExamples"
  > extends true
    ? ExactEndpointResponseExamplesAuthoringTuple<TSpec, TSpec["responseExamples"]>
    : TSpec["responseExamples"];
};

export type Endpoint<TSpec extends ExactEndpointAuthoringSpec<TSpec>> = {
  readonly __endpoint?: TSpec;
};

export type Brand<TInner, TName extends string> = TInner & {
  readonly __brand: TName;
};

/**
 * Brands a value WITHOUT validating it, for mocks and tests; production
 * values come from the domain's validating constructor. The brand name is
 * inferred from where the value goes: `const email: Email = brand("jane@example.com")`.
 * Only the name comes from context, so a structurally identical `Brand`
 * declared elsewhere brands just as well.
 */
export function brand<TInner, TName extends string>(value: TInner): Brand<TInner, TName>;
export function brand(value: unknown): unknown {
  return value;
}

/** Format metadata on a primitive. Not nominal: any `TInner` value is assignable. */
export type Format<TInner, TFormat extends string> = TInner & {
  readonly __format?: TFormat;
};
