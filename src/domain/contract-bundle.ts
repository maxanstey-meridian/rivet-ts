import { ContractSpec } from "./contract.js";
import { ExtractionDiagnostic } from "./diagnostic.js";

export class ContractBundle {
  public readonly entryPath: string;
  public readonly contracts: readonly ContractSpec[];
  public readonly referencedTypes: readonly string[];
  public readonly diagnostics: readonly ExtractionDiagnostic[];

  public constructor(input: {
    entryPath: string;
    contracts: readonly ContractSpec[];
    referencedTypes?: readonly string[];
    diagnostics?: readonly ExtractionDiagnostic[];
  }) {
    this.entryPath = input.entryPath;
    this.contracts = input.contracts;
    this.referencedTypes = input.referencedTypes ?? [];
    this.diagnostics = input.diagnostics ?? [];
  }

  public get hasErrors(): boolean {
    return this.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  }
}
