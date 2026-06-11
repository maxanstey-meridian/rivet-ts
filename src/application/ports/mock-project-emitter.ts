import type { DiscoveredContract } from "../../domain/rivet-contract-lowering-result.js";
import { RivetContractDocument } from "../../domain/rivet-contract.js";

export type MockProjectEmitterConfig = {
  outDir: string;
  projectName: string;
  entryPath: string;
  contractJsonFileName: string;
  contracts: readonly DiscoveredContract[];
  document: RivetContractDocument;
};

export abstract class MockProjectEmitter {
  public abstract emit(config: MockProjectEmitterConfig): Promise<void>;
}
