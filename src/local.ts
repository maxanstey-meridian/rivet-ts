type LocalRivetBaseConfig = {
  readonly baseUrl: string;
  readonly fetch?: LocalRivetFetch;
};

/**
 * Matches `openapi-fetch`'s `ClientOptions["fetch"]` seam: the configured
 * client hands a fully-built `Request` to the custom fetch.
 */
type LocalRivetFetch = (input: Request) => Promise<Response>;

type LocalRivetDispatch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Response | Promise<Response>;

export type LocalRivetConfig<TConfig extends LocalRivetBaseConfig> = Omit<
  TConfig,
  "fetch" | "baseUrl"
> & {
  readonly configureRivet: (config: TConfig) => void;
  readonly dispatch: LocalRivetDispatch;
  readonly baseUrl?: string;
};

export const createLocalRivetFetch = (dispatch: LocalRivetDispatch): LocalRivetFetch => {
  return (input: Request): Promise<Response> => Promise.resolve(dispatch(input));
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
