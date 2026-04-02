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
  readonly successStatus?: number;
  readonly summary?: string;
  readonly description?: string;
  readonly errors?: readonly EndpointErrorAuthoringSpec[];
  readonly anonymous?: boolean;
  readonly security?: EndpointSecurityAuthoringSpec;
  readonly fileResponse?: boolean;
  readonly fileContentType?: string;
};

type ExactEndpointAuthoringSpec<TSpec extends EndpointAuthoringSpec> = EndpointAuthoringSpec & {
  readonly [TKey in Exclude<keyof TSpec, keyof EndpointAuthoringSpec>]: never;
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
