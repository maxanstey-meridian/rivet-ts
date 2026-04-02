export type Contract<TName extends string> = {
  readonly __contractName?: TName;
};

export type Endpoint<TSpec> = {
  readonly __endpoint?: TSpec;
};

export type Brand<TInner, TName extends string> = TInner & {
  readonly __brand: TName;
};

export type Format<TInner, TFormat extends string> = TInner & {
  readonly __format: TFormat;
};
