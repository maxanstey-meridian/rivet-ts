export type Contract<TName extends string> = {
  readonly __contractName?: TName;
};

export type EndpointAuthoringHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

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

export type InlineEndpointRequestExampleAuthoringSpec<
  TExample = EndpointExampleAuthoringValue,
> = EndpointRequestExampleAuthoringDescriptor & {
  readonly json: EndpointExampleAuthoringReference<TExample>;
};

export type RefEndpointRequestExampleAuthoringSpec<
  TExample = EndpointExampleAuthoringValue,
> = EndpointRequestExampleAuthoringDescriptor & {
  readonly componentExampleId: string;
  readonly resolvedJson: EndpointExampleAuthoringReference<TExample>;
};

export type EndpointRequestExampleAuthoringSpec<TExample = EndpointExampleAuthoringValue> =
  | InlineEndpointRequestExampleAuthoringSpec<TExample>
  | RefEndpointRequestExampleAuthoringSpec<TExample>;

export type EndpointAuthoringSpec = {
  readonly method: EndpointAuthoringHttpMethod;
  readonly route: string;
  readonly input?: unknown;
  readonly response?: unknown;
  readonly requestExample?: EndpointExampleAuthoringReference;
  readonly requestExamples?: readonly (
    | EndpointExampleAuthoringReference
    | EndpointRequestExampleAuthoringSpec
  )[];
  readonly successResponseExample?: EndpointExampleAuthoringReference;
  readonly successStatus?: number;
  readonly summary?: string;
  readonly description?: string;
  readonly errors?: readonly EndpointErrorAuthoringSpec[];
  readonly anonymous?: boolean;
  readonly security?: EndpointSecurityAuthoringSpec;
  readonly fileResponse?: boolean;
  readonly fileContentType?: string;
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
        RefEndpointRequestExampleAuthoringSpec<
          "input" extends keyof TSpec ? TSpec["input"] : never
        >
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

type HasSpecificEndpointExampleAuthoringReference<
  TSpec extends EndpointAuthoringSpec,
  TKey extends "requestExample" | "requestExamples" | "successResponseExample",
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
};

export type Endpoint<TSpec extends ExactEndpointAuthoringSpec<TSpec>> = {
  readonly __endpoint?: TSpec;
};

export type Brand<TInner, TName extends string> = TInner & {
  readonly __brand: TName;
};

export type Format<TInner, TFormat extends string> = TInner & {
  readonly __format: TFormat;
};
