import path from "node:path";
import ts from "typescript";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  skipLibCheck: true,
  allowJs: false,
  noEmit: true,
  resolveJsonModule: true,
  ignoreDeprecations: "6.0",
  esModuleInterop: true,
  verbatimModuleSyntax: true,
};

export type ResolvedTypeScriptProject = Readonly<{
  absoluteEntryPath: string;
  compilerOptions: ts.CompilerOptions;
  configFilePath: string | null;
  configDiagnostics: readonly ts.Diagnostic[];
}>;

export const mapTypeScriptDiagnostics = (
  diagnostics: readonly ts.Diagnostic[],
  defaultFilePath: string,
): ExtractionDiagnostic[] => {
  return diagnostics.map((diagnostic) => {
    if (!diagnostic.file || diagnostic.start === undefined) {
      return new ExtractionDiagnostic({
        severity: diagnostic.category === ts.DiagnosticCategory.Warning ? "warning" : "error",
        code: `TS${diagnostic.code}`,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        filePath: defaultFilePath,
      });
    }

    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);

    return new ExtractionDiagnostic({
      severity: diagnostic.category === ts.DiagnosticCategory.Warning ? "warning" : "error",
      code: `TS${diagnostic.code}`,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      filePath: diagnostic.file.fileName,
      line: position.line + 1,
      column: position.character + 1,
    });
  });
};

export const resolveTypeScriptProject = (
  entryPath: string,
  tsconfigPath?: string,
): ResolvedTypeScriptProject => {
  const absoluteEntryPath = path.resolve(entryPath);
  const resolvedTsconfigPath =
    tsconfigPath !== undefined
      ? path.resolve(tsconfigPath)
      : ts.findConfigFile(path.dirname(absoluteEntryPath), ts.sys.fileExists, "tsconfig.json") ??
        null;

  if (resolvedTsconfigPath === null) {
    return {
      absoluteEntryPath,
      compilerOptions: DEFAULT_COMPILER_OPTIONS,
      configDiagnostics: [],
      configFilePath: null,
    };
  }

  const readConfigResult = ts.readConfigFile(resolvedTsconfigPath, ts.sys.readFile);

  if (readConfigResult.error) {
    return {
      absoluteEntryPath,
      compilerOptions: DEFAULT_COMPILER_OPTIONS,
      configDiagnostics: [readConfigResult.error],
      configFilePath: resolvedTsconfigPath,
    };
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    readConfigResult.config,
    ts.sys,
    path.dirname(resolvedTsconfigPath),
    {},
    resolvedTsconfigPath,
  );

  return {
    absoluteEntryPath,
    compilerOptions: {
      ...DEFAULT_COMPILER_OPTIONS,
      ...parsedConfig.options,
      noEmit: true,
    },
    configDiagnostics: parsedConfig.errors,
    configFilePath: resolvedTsconfigPath,
  };
};
