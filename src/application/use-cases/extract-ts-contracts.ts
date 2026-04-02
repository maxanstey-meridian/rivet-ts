import { ContractBundle } from "../../domain/contract-bundle.js";
import { TsContractFrontend } from "../ports/ts-contract-frontend.js";

export class ExtractTsContracts {
  private readonly frontend: TsContractFrontend;

  public constructor(frontend: TsContractFrontend) {
    this.frontend = frontend;
  }

  public async execute(input: { entryPath: string }): Promise<ContractBundle> {
    return this.frontend.extract(input.entryPath);
  }
}
