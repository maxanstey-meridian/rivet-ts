export type DiagnosticSeverity = "error" | "warning";

export class ExtractionDiagnostic {
  public readonly severity: DiagnosticSeverity;
  public readonly code: string;
  public readonly message: string;
  public readonly filePath?: string;
  public readonly line?: number;
  public readonly column?: number;

  public constructor(input: {
    severity: DiagnosticSeverity;
    code: string;
    message: string;
    filePath?: string;
    line?: number;
    column?: number;
  }) {
    this.severity = input.severity;
    this.code = input.code;
    this.message = input.message;
    this.filePath = input.filePath;
    this.line = input.line;
    this.column = input.column;
  }
}
