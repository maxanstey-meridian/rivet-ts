import { app } from "./api.js";
import { configureRivet as configureGeneratedRivet, type RivetConfig } from "../generated/rivet/rivet.js";

type LocalRivetConfig = Omit<RivetConfig, "fetch" | "baseUrl"> & {
  readonly baseUrl?: string;
};

export const configureLocalRivet = (config: LocalRivetConfig = {}): void => {
  configureGeneratedRivet({
    ...config,
    baseUrl: config.baseUrl ?? "http://local",
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(app.request(input as string, init)),
  });
};
