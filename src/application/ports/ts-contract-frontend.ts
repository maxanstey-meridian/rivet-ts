import { ContractBundle } from "../../domain/contract-bundle.js";

export abstract class TsContractFrontend {
  public abstract extract(entryPath: string): Promise<ContractBundle>;
}
