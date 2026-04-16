import { HandlerDiscoveryResult } from "../../domain/handler-discovery-result.js";

export abstract class HandlerEntrypointFrontend {
  public abstract discover(entryPath: string): Promise<HandlerDiscoveryResult>;
}
