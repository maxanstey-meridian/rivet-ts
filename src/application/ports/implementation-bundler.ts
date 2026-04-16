import type { BundleResult } from "../../domain/bundle-result.js";
import type { BuildLocalTarget } from "../../domain/build-local-config.js";
import type { HandlerGroup } from "../../domain/handler-group.js";

export abstract class ImplementationBundler {
  public abstract bundle(
    entryPath: string,
    handlerGroups: readonly HandlerGroup[],
    target: BuildLocalTarget,
    outDir: string,
    tsconfigPath?: string,
  ): Promise<BundleResult>;
}
