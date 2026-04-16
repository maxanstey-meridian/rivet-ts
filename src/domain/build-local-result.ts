import { ExtractionDiagnostic } from "./diagnostic.js";
import { HandlerGroup } from "./handler-group.js";
import { RivetContractDocument } from "./rivet-contract.js";

export class BuildLocalResult {
  public readonly handlerGroups: readonly HandlerGroup[];
  public readonly contractDocuments: Map<string, RivetContractDocument>;
  public readonly diagnostics: readonly ExtractionDiagnostic[];

  public constructor(input: {
    handlerGroups: readonly HandlerGroup[];
    contractDocuments: Map<string, RivetContractDocument>;
    diagnostics?: readonly ExtractionDiagnostic[];
  }) {
    this.handlerGroups = input.handlerGroups;
    this.contractDocuments = input.contractDocuments;
    this.diagnostics = input.diagnostics ?? [];
  }

  public get hasErrors(): boolean {
    return this.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  }
}
