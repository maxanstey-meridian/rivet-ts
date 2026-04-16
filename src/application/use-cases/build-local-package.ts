import { HandlerEntrypointFrontend } from "../ports/handler-entrypoint-frontend.js";
import { RivetContractLowerer } from "../ports/rivet-contract-lowerer.js";
import { TsContractFrontend } from "../ports/ts-contract-frontend.js";
import { BuildLocalConfig } from "../../domain/build-local-config.js";
import { BuildLocalResult } from "../../domain/build-local-result.js";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import { RivetContractDocument } from "../../domain/rivet-contract.js";

export class BuildLocalPackage {
  private readonly handlerFrontend: HandlerEntrypointFrontend;
  private readonly contractFrontend: TsContractFrontend;
  private readonly lowerer: RivetContractLowerer;

  public constructor(
    handlerFrontend: HandlerEntrypointFrontend,
    contractFrontend: TsContractFrontend,
    lowerer: RivetContractLowerer,
  ) {
    this.handlerFrontend = handlerFrontend;
    this.contractFrontend = contractFrontend;
    this.lowerer = lowerer;
  }

  public async execute(config: BuildLocalConfig): Promise<BuildLocalResult> {
    const diagnostics: ExtractionDiagnostic[] = [];

    const discoveryResult = await this.handlerFrontend.discover(config.entryPath);
    diagnostics.push(...discoveryResult.diagnostics);

    if (discoveryResult.hasErrors) {
      return new BuildLocalResult({
        handlerGroups: [],
        contractDocuments: new Map(),
        diagnostics,
      });
    }

    const contractDocuments = new Map<string, RivetContractDocument>();
    const documentBySourcePath = new Map<string, RivetContractDocument>();

    const uniqueSourcePaths = [
      ...new Set(discoveryResult.handlerGroups.map((g) => g.contractSourcePath)),
    ];

    for (const sourcePath of uniqueSourcePaths) {
      const bundle = await this.contractFrontend.extract(sourcePath);
      diagnostics.push(...bundle.diagnostics);

      if (bundle.hasErrors) {
        continue;
      }

      const loweringResult = await this.lowerer.lower(bundle);
      diagnostics.push(...loweringResult.diagnostics);

      if (loweringResult.hasErrors) {
        continue;
      }

      documentBySourcePath.set(sourcePath, loweringResult.document);
    }

    for (const group of discoveryResult.handlerGroups) {
      const document = documentBySourcePath.get(group.contractSourcePath);
      if (document) {
        contractDocuments.set(group.contractName, document);
      }
    }

    return new BuildLocalResult({
      handlerGroups: [...discoveryResult.handlerGroups],
      contractDocuments,
      diagnostics,
    });
  }
}
