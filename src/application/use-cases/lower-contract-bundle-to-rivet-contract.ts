import { ContractBundle } from "../../domain/contract-bundle.js";
import { RivetContractLoweringResult } from "../../domain/rivet-contract-lowering-result.js";
import { RivetContractLowerer } from "../ports/rivet-contract-lowerer.js";

export class LowerContractBundleToRivetContract {
  private readonly lowerer: RivetContractLowerer;

  public constructor(lowerer: RivetContractLowerer) {
    this.lowerer = lowerer;
  }

  public async execute(input: { bundle: ContractBundle }): Promise<RivetContractLoweringResult> {
    return this.lowerer.lower(input.bundle);
  }
}
