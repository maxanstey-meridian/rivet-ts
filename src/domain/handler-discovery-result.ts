import { ExtractionDiagnostic } from "./diagnostic.js";
import { HandlerGroup } from "./handler-group.js";

export class HandlerDiscoveryResult {
  public readonly entryPath: string;
  public readonly handlerGroups: readonly HandlerGroup[];
  public readonly diagnostics: readonly ExtractionDiagnostic[];

  public constructor(input: {
    entryPath: string;
    handlerGroups?: readonly HandlerGroup[];
    diagnostics?: readonly ExtractionDiagnostic[];
  }) {
    this.entryPath = input.entryPath;
    this.handlerGroups = input.handlerGroups ?? [];
    this.diagnostics = input.diagnostics ?? [];
  }

  public get hasErrors(): boolean {
    return this.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  }
}
