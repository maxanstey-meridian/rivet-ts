import { HandlerEntrypointFrontend } from "../ports/handler-entrypoint-frontend.js";
import { ImplementationBundler } from "../ports/implementation-bundler.js";
import { LocalClientCodegen } from "../ports/local-client-codegen.js";
import { PackageEmitter } from "../ports/package-emitter.js";
import { RivetContractLowerer } from "../ports/rivet-contract-lowerer.js";
import { TsContractFrontend } from "../ports/ts-contract-frontend.js";
import { BuildLocalConfig } from "../../domain/build-local-config.js";
import { BuildLocalResult } from "../../domain/build-local-result.js";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import type { GeneratedClientModule } from "../../domain/generated-client-module.js";
import { RivetContractDocument } from "../../domain/rivet-contract.js";

export class BuildLocalPackage {
  private readonly handlerFrontend: HandlerEntrypointFrontend;
  private readonly contractFrontend: TsContractFrontend;
  private readonly lowerer: RivetContractLowerer;
  private readonly codegen: LocalClientCodegen;
  private readonly bundler: ImplementationBundler;
  private readonly emitter: PackageEmitter;

  public constructor(
    handlerFrontend: HandlerEntrypointFrontend,
    contractFrontend: TsContractFrontend,
    lowerer: RivetContractLowerer,
    codegen: LocalClientCodegen,
    bundler: ImplementationBundler,
    emitter: PackageEmitter,
  ) {
    this.handlerFrontend = handlerFrontend;
    this.contractFrontend = contractFrontend;
    this.lowerer = lowerer;
    this.codegen = codegen;
    this.bundler = bundler;
    this.emitter = emitter;
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

    if (diagnostics.some((d) => d.severity === "error")) {
      return new BuildLocalResult({
        handlerGroups: [...discoveryResult.handlerGroups],
        contractDocuments,
        diagnostics,
      });
    }

    // Generate client modules
    const clientModules: GeneratedClientModule[] = [];
    for (const group of discoveryResult.handlerGroups) {
      const document = contractDocuments.get(group.contractName);
      if (document) {
        clientModules.push(this.codegen.generate(group, document));
      }
    }

    // Bundle implementations
    const bundleResult = await this.bundler.bundle(
      config.entryPath,
      discoveryResult.handlerGroups,
      config.target,
      config.outDir,
    );
    diagnostics.push(...bundleResult.diagnostics);

    if (bundleResult.hasErrors) {
      return new BuildLocalResult({
        handlerGroups: [...discoveryResult.handlerGroups],
        contractDocuments,
        diagnostics,
      });
    }

    // Emit package
    await this.emitter.emit({
      outDir: config.outDir,
      packageName: config.packageName,
      target: config.target,
      clientModules,
      bundleFiles: bundleResult.outputFiles,
      contractDocuments,
    });

    return new BuildLocalResult({
      handlerGroups: [...discoveryResult.handlerGroups],
      contractDocuments,
      diagnostics,
    });
  }
}
