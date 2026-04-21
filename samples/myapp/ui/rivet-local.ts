import { app } from "@myapp/api/local";
import { configureRivet, type RivetConfig } from "@myapp/client";
import { configureLocalRivet as configureRivetLocalRuntime } from "rivet-ts/local";

type LocalRivetConfig = Omit<RivetConfig, "fetch" | "baseUrl"> & {
  readonly baseUrl?: string;
};

/* Replace this with configureRivet({ baseUrl: "https://api.example.com" }) when you are ready to promote the API to a real server. */
export const configureLocalRivet = (config: LocalRivetConfig = {}) => {
  configureRivetLocalRuntime({
    ...config,
    configureRivet,
    dispatch: (input, init) => app.request(input as string, init),
  });
};
