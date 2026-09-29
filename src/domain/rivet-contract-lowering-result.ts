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
  /** The lowered document endpoint's `name`. */
  loweredName: string;
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
  /** The lowered document endpoints' `controllerName`. */
  controllerName: string;
  sourceFilePath: string;
  endpoints: readonly DiscoveredEndpoint[];
}>;

/**
 * A contract source file the lowering program compiled: the entry and every
 * local module it reaches (relative imports, tsconfig `paths`, type queries),
 * excluding declaration files and packages.
 */
export type ContractSourceFile = Readonly<{
  absolutePath: string;
  /** POSIX path relative to the directory all contract source files share. */
  relativePath: string;
}>;

export class RivetContractLoweringResult {
  public readonly document: RivetContractDocument;
  public readonly diagnostics: readonly ExtractionDiagnostic[];
  public readonly contracts: readonly DiscoveredContract[];
  public readonly sourceFiles: readonly ContractSourceFile[];

  public constructor(input: {
    document: RivetContractDocument;
    diagnostics?: readonly ExtractionDiagnostic[];
    contracts?: readonly DiscoveredContract[];
    sourceFiles?: readonly ContractSourceFile[];
  }) {
    this.document = input.document;
    this.diagnostics = input.diagnostics ?? [];
    this.contracts = input.contracts ?? [];
    this.sourceFiles = input.sourceFiles ?? [];
  }

  public get hasErrors(): boolean {
    return this.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  }

  public toJson(): string {
    return JSON.stringify(this.document, null, 2);
  }
}
