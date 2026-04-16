import { HandlerDiscoveryResult } from "../../domain/handler-discovery-result.js";
import { HandlerEntrypointFrontend } from "../ports/handler-entrypoint-frontend.js";

export class DiscoverHandlerEntrypoints {
  private readonly frontend: HandlerEntrypointFrontend;

  public constructor(frontend: HandlerEntrypointFrontend) {
    this.frontend = frontend;
  }

  public async execute(input: { entryPath: string }): Promise<HandlerDiscoveryResult> {
    return this.frontend.discover(input.entryPath);
  }
}
