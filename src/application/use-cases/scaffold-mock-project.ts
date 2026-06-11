import path from "node:path";
import { ScaffoldMockConfig } from "../../domain/scaffold-mock-config.js";
import { ScaffoldMockResult } from "../../domain/scaffold-mock-result.js";
import { MockProjectEmitter } from "../ports/mock-project-emitter.js";
import { RivetContractLowerer } from "../ports/rivet-contract-lowerer.js";

export class ScaffoldMockProject {
  private readonly lowerer: RivetContractLowerer;
  private readonly emitter: MockProjectEmitter;

  public constructor(lowerer: RivetContractLowerer, emitter: MockProjectEmitter) {
    this.lowerer = lowerer;
    this.emitter = emitter;
  }

  public async execute(config: ScaffoldMockConfig): Promise<ScaffoldMockResult> {
    const lowered = await this.lowerer.lower(config.entryPath);
    const diagnostics = [...lowered.diagnostics];

    if (lowered.hasErrors) {
      return new ScaffoldMockResult({
        document: lowered.document,
        diagnostics,
      });
    }

    const projectName = config.projectName ?? path.basename(config.outDir);

    await this.emitter.emit({
      outDir: config.outDir,
      projectName,
      entryPath: config.entryPath,
      force: config.force,
      contracts: lowered.contracts,
      document: lowered.document,
    });

    return new ScaffoldMockResult({
      document: lowered.document,
      diagnostics,
    });
  }
}
