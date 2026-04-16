import { ExtractionDiagnostic } from "./diagnostic.js";

export class BundleResult {
  public readonly outputFiles: Map<string, string>;
  public readonly diagnostics: readonly ExtractionDiagnostic[];

  public constructor(input: {
    outputFiles: Map<string, string>;
    diagnostics: readonly ExtractionDiagnostic[];
  }) {
    this.outputFiles = input.outputFiles;
    this.diagnostics = input.diagnostics;
  }

  public get hasErrors(): boolean {
    return this.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  }
}
