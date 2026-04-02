import { ExtractionDiagnostic } from "./diagnostic.js";
import { RivetContractDocument } from "./rivet-contract.js";

export class RivetContractLoweringResult {
  public readonly document: RivetContractDocument;
  public readonly diagnostics: readonly ExtractionDiagnostic[];

  public constructor(input: {
    document: RivetContractDocument;
    diagnostics?: readonly ExtractionDiagnostic[];
  }) {
    this.document = input.document;
    this.diagnostics = input.diagnostics ?? [];
  }

  public get hasErrors(): boolean {
    return this.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  }

  public toJSON(): RivetContractDocument {
    return this.document;
  }

  public toJson(): string {
    return JSON.stringify(this.toJSON(), null, 2);
  }
}
