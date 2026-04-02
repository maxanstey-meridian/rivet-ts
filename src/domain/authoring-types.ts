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

export type EndpointAuthoringSpec = {
  readonly method: EndpointAuthoringHttpMethod;
  readonly route: string;
  readonly input?: unknown;
  readonly response?: unknown;
  readonly requestExample?: unknown;
  readonly successResponseExample?: unknown;
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

type ExactEndpointAuthoringSpec<TSpec extends EndpointAuthoringSpec> = ExactAuthoringShape<
  TSpec,
  EndpointAuthoringSpec
> & {
  readonly errors?: ExactEndpointErrorAuthoringTuple<TSpec["errors"]>;
  readonly security?: TSpec["security"] extends EndpointSecurityAuthoringSpec
    ? ExactEndpointSecurityAuthoringSpec<TSpec["security"]>
    : TSpec["security"];
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
