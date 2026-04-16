import type { BuildLocalTarget } from "../../domain/build-local-config.js";
import type { GeneratedClientModule } from "../../domain/generated-client-module.js";
import type { RivetContractDocument } from "../../domain/rivet-contract.js";

export type PackageEmitterConfig = {
  readonly outDir: string;
  readonly packageName: string;
  readonly target: BuildLocalTarget;
  readonly clientModules: readonly GeneratedClientModule[];
  readonly bundleFiles: Map<string, string>;
  readonly contractDocuments: Map<string, RivetContractDocument>;
};

export abstract class PackageEmitter {
  public abstract emit(config: PackageEmitterConfig): Promise<void>;
}
