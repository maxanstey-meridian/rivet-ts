import path from "node:path";
import { MockProjectEmitter } from "../ports/mock-project-emitter.js";
import { RivetContractLowerer } from "../ports/rivet-contract-lowerer.js";
import { TsContractFrontend } from "../ports/ts-contract-frontend.js";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import { RivetContractDocument } from "../../domain/rivet-contract.js";
import { ScaffoldMockConfig } from "../../domain/scaffold-mock-config.js";
import { ScaffoldMockResult } from "../../domain/scaffold-mock-result.js";

const EMPTY_DOCUMENT = new RivetContractDocument({});

export class ScaffoldMockProject {
  private readonly contractFrontend: TsContractFrontend;
  private readonly lowerer: RivetContractLowerer;
  private readonly emitter: MockProjectEmitter;

  public constructor(
    contractFrontend: TsContractFrontend,
    lowerer: RivetContractLowerer,
    emitter: MockProjectEmitter,
  ) {
    this.contractFrontend = contractFrontend;
    this.lowerer = lowerer;
    this.emitter = emitter;
  }

  public async execute(config: ScaffoldMockConfig): Promise<ScaffoldMockResult> {
    const diagnostics: ExtractionDiagnostic[] = [];
    const bundle = await this.contractFrontend.extract(config.entryPath);
    diagnostics.push(...bundle.diagnostics);

    if (bundle.hasErrors) {
      return new ScaffoldMockResult({
        document: EMPTY_DOCUMENT,
        diagnostics,
      });
    }

    const lowered = await this.lowerer.lower(bundle);
    diagnostics.push(...lowered.diagnostics);

    if (lowered.hasErrors) {
      return new ScaffoldMockResult({
        document: lowered.document,
        diagnostics,
      });
    }

    const projectName = config.projectName ?? path.basename(config.outDir);
    const contractJsonFileName = "api.contract.json";

    await this.emitter.emit({
      outDir: config.outDir,
      projectName,
      entryPath: config.entryPath,
      contractJsonFileName,
      bundle,
      document: lowered.document,
    });

    return new ScaffoldMockResult({
      document: lowered.document,
      diagnostics,
    });
  }
}
