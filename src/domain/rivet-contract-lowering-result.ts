import { ExtractionDiagnostic } from "./diagnostic.js";
import { RivetContractDocument, type RivetType } from "./rivet-contract.js";

/**
 * An authored endpoint as contract discovery found it, joined to its lowered
 * document endpoint through `loweredName`.
 */
export type DiscoveredEndpoint = Readonly<{
  /** Authored (PascalCase) endpoint member name. */
  name: string;
  /** The lowered document endpoint's `name`. */
  loweredName: string;
  method: string;
  route: string;
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

/**
 * The tsconfig `paths` entries whose targets lie among the contract source
 * files, each target a POSIX path relative to the same directory as
 * `ContractSourceFile.relativePath` (`{ "@models/*": ["models/*"] }`).
 */
export type ContractSourcePathAliases = Readonly<Record<string, readonly string[]>>;

/**
 * A TS `enum` declaration among the contract source files, for emitting
 * member references (`MemberStatus.Active`): a raw value is not assignable to
 * a TS enum. Enum-like type aliases lower to document enums too but are absent
 * here — their literals are assignable as written.
 */
export type ContractEnumDeclaration = Readonly<{
  /** The exported enum identifier, which is also the document enum's `name`. */
  name: string;
  /** Where the enum's runtime object can be imported from, or why it cannot. */
  source:
    | Readonly<{
        kind: "module";
        /** POSIX path of the declaring module, relative like `ContractSourceFile.relativePath`. */
        relativePath: string;
      }>
    /** Declared outside the contract source files (a library mapped in through tsconfig `paths`). */
    | Readonly<{ kind: "outsideContractSources" }>
    /** A `declare enum`: a type only, with no runtime object to import. */
    | Readonly<{ kind: "ambient" }>;
  /** In declaration order, each with the value the document enum carries. */
  members: readonly Readonly<{ name: string; value: string | number }>[];
}>;

export class RivetContractLoweringResult {
  public readonly document: RivetContractDocument;
  public readonly diagnostics: readonly ExtractionDiagnostic[];
  public readonly contracts: readonly DiscoveredContract[];
  public readonly sourceFiles: readonly ContractSourceFile[];
  public readonly sourcePathAliases: ContractSourcePathAliases;
  public readonly enumDeclarations: readonly ContractEnumDeclaration[];
  /**
   * Every node of `document` that was a TS `Date`, by object identity: the
   * contract JSON writes them as `date-time` strings, like
   * `Format<string, "date-time">`, but code typed by the contract holds a
   * `Date`. Valid for this result's `document`, and for a document built from it
   * that keeps its type objects, as `enrichDocumentWithConstraints` does.
   */
  public readonly dateTypes: ReadonlySet<RivetType>;

  public constructor(input: {
    document: RivetContractDocument;
    diagnostics?: readonly ExtractionDiagnostic[];
    contracts?: readonly DiscoveredContract[];
    sourceFiles?: readonly ContractSourceFile[];
    sourcePathAliases?: ContractSourcePathAliases;
    enumDeclarations?: readonly ContractEnumDeclaration[];
    dateTypes?: ReadonlySet<RivetType>;
  }) {
    this.document = input.document;
    this.diagnostics = input.diagnostics ?? [];
    this.contracts = input.contracts ?? [];
    this.sourceFiles = input.sourceFiles ?? [];
    this.sourcePathAliases = input.sourcePathAliases ?? {};
    this.enumDeclarations = input.enumDeclarations ?? [];
    this.dateTypes = input.dateTypes ?? new Set();
  }

  public get hasErrors(): boolean {
    return this.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  }

  public toJson(): string {
    return JSON.stringify(this.document, null, 2);
  }
}
