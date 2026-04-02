export type Contract<TName extends string> = {
  readonly __contractName?: TName;
};

export type Endpoint<TSpec> = {
  readonly __endpoint?: TSpec;
};
