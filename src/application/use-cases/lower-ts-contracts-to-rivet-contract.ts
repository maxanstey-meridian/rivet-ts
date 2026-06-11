import { RivetContractLoweringResult } from "../../domain/rivet-contract-lowering-result.js";
import { RivetContractLowerer } from "../ports/rivet-contract-lowerer.js";

/**
 * Lowers TypeScript-authored contracts straight from the entry file into the
 * Rivet contract document. This is the single AST→document pass that replaced
 * the former extract (ContractBundle) + lower pipeline (X13 collapse).
 */
export class LowerTsContractsToRivetContract {
  private readonly lowerer: RivetContractLowerer;

  public constructor(lowerer: RivetContractLowerer) {
    this.lowerer = lowerer;
  }

  public async execute(input: { entryPath: string }): Promise<RivetContractLoweringResult> {
    return this.lowerer.lower(input.entryPath);
  }
}
