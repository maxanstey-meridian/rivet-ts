import type { ExtractionDiagnostic } from "../domain/diagnostic.js";

export const formatDiagnostic = (diagnostic: ExtractionDiagnostic): string => {
  const location = diagnostic.filePath
    ? `${diagnostic.filePath}${diagnostic.line ? `:${diagnostic.line}:${diagnostic.column}` : ""}`
    : "(unknown)";
  return `${diagnostic.severity}: [${diagnostic.code}] ${location} ${diagnostic.message}`;
};
