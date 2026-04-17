import { ContractBundle } from "../../domain/contract-bundle.js";
import { RivetContractDocument } from "../../domain/rivet-contract.js";

export type MockProjectEmitterConfig = {
  outDir: string;
  projectName: string;
  entryPath: string;
  contractJsonFileName: string;
  bundle: ContractBundle;
  document: RivetContractDocument;
};

export abstract class MockProjectEmitter {
  public abstract emit(config: MockProjectEmitterConfig): Promise<void>;
}
