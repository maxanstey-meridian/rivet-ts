type LocalRivetBaseConfig = {
  readonly baseUrl: string;
  readonly headers?: () => Record<string, string> | Promise<Record<string, string>>;
  readonly fetch?: LocalRivetFetch;
};

type LocalRivetFetch = (input: string | URL, init?: RequestInit) => Response | Promise<Response>;

type LocalRivetDispatch = LocalRivetFetch;

export type LocalRivetConfig<TConfig extends LocalRivetBaseConfig> = Omit<
  TConfig,
  "fetch" | "baseUrl"
> & {
  readonly configureRivet: (config: TConfig) => void;
  readonly dispatch: LocalRivetDispatch;
  readonly baseUrl?: string;
};

export const createLocalRivetFetch = (dispatch: LocalRivetDispatch): LocalRivetFetch => {
  return (input: string | URL, init?: RequestInit): Promise<Response> =>
    Promise.resolve(dispatch(input, init));
};

export const configureLocalRivet = <TConfig extends LocalRivetBaseConfig>(
  config: LocalRivetConfig<TConfig>,
): void => {
  const { configureRivet, dispatch, baseUrl, ...rest } = config;

  configureRivet({
    ...(rest as unknown as Omit<TConfig, "fetch" | "baseUrl">),
    baseUrl: baseUrl ?? "http://local",
    fetch: createLocalRivetFetch(dispatch),
  } as TConfig);
};
