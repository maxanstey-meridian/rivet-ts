import { ContractBundle } from "../../domain/contract-bundle.js";
import { RivetContractLoweringResult } from "../../domain/rivet-contract-lowering-result.js";

export abstract class RivetContractLowerer {
  protected constructor() {}

  public abstract lower(bundle: ContractBundle): Promise<RivetContractLoweringResult>;
}
