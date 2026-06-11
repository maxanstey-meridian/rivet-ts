import { RivetContractLoweringResult } from "../../domain/rivet-contract-lowering-result.js";

export abstract class RivetContractLowerer {
  protected constructor() {}

  /**
   * Single pass from a TypeScript entry file to the lowered Rivet contract
   * document, including contract discovery and its diagnostics (X13).
   */
  public abstract lower(entryPath: string): Promise<RivetContractLoweringResult>;
}
