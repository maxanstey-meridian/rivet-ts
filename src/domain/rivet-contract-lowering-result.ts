import { ExtractionDiagnostic } from "./diagnostic.js";
import { RivetContractDocument } from "./rivet-contract.js";

/**
 * Authored-spec facts surfaced by the contract-discovery stage of the single
 * lowering pass (X13 collapse). Consumers that need the authored shape —
 * e.g. the scaffold-mock handler generator, which mirrors the type-level
 * RivetHandlerInput bag — read these instead of the lowered document.
 */
export type DiscoveredEndpoint = Readonly<{
  /** Authored (PascalCase) endpoint member name. */
  name: string;
  method: string;
  route: string;
  hasInput: boolean;
  hasParams: boolean;
  hasQuery: boolean;
}>;

export type DiscoveredContract = Readonly<{
  /** Contract brand name — the `Contract<"Name">` string literal; matches the lowered document. */
  name: string;
  /**
   * Exported interface identifier (e.g. `TicketsContract` for
   * `Contract<"Tickets">`) — the only name that resolves in emitted
   * `import type { ... }` positions.
   */
  exportedName: string;
  sourceFilePath: string;
  endpoints: readonly DiscoveredEndpoint[];
}>;

export class RivetContractLoweringResult {
  public readonly document: RivetContractDocument;
  public readonly diagnostics: readonly ExtractionDiagnostic[];
  public readonly contracts: readonly DiscoveredContract[];

  public constructor(input: {
    document: RivetContractDocument;
    diagnostics?: readonly ExtractionDiagnostic[];
    contracts?: readonly DiscoveredContract[];
  }) {
    this.document = input.document;
    this.diagnostics = input.diagnostics ?? [];
    this.contracts = input.contracts ?? [];
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
