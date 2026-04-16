import path from "node:path";
import ts from "typescript";
import { HandlerEntrypointFrontend } from "../../application/ports/handler-entrypoint-frontend.js";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import { HandlerDiscoveryResult } from "../../domain/handler-discovery-result.js";
import { HandlerGroup } from "../../domain/handler-group.js";

export class TypeScriptHandlerEntrypointFrontend extends HandlerEntrypointFrontend {
  public async discover(entryPath: string): Promise<HandlerDiscoveryResult> {
    const absoluteEntryPath = path.resolve(entryPath);

    const program = ts.createProgram([absoluteEntryPath], {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      skipLibCheck: true,
      allowJs: false,
      noEmit: true,
      resolveJsonModule: true,
      esModuleInterop: true,
      verbatimModuleSyntax: true,
    });

    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(absoluteEntryPath);
    const diagnostics: ExtractionDiagnostic[] = [];

    if (!sourceFile) {
      return new HandlerDiscoveryResult({
        entryPath: absoluteEntryPath,
        diagnostics: [
          new ExtractionDiagnostic({
            severity: "error",
            code: "ENTRY_NOT_FOUND",
            message: `Could not load entry file: ${absoluteEntryPath}`,
            filePath: absoluteEntryPath,
          }),
        ],
      });
    }

    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) {
      return new HandlerDiscoveryResult({
        entryPath: absoluteEntryPath,
        diagnostics: [
          new ExtractionDiagnostic({
            severity: "error",
            code: "NO_MODULE_SYMBOL",
            message: `Could not resolve module for: ${absoluteEntryPath}`,
            filePath: absoluteEntryPath,
          }),
        ],
      });
    }

    const handlerGroups: HandlerGroup[] = [];

    for (const exportSymbol of checker.getExportsOfModule(moduleSymbol)) {
      const resolved = this.resolveAlias(exportSymbol, checker);

      // Skip type-only exports (no value declaration)
      if (!resolved.valueDeclaration) {
        continue;
      }

      const group = this.extractHandlerGroup(exportSymbol.name, resolved, checker, diagnostics);
      if (group) {
        handlerGroups.push(group);
      }
    }

    if (handlerGroups.length === 0) {
      diagnostics.push(
        new ExtractionDiagnostic({
          severity: "error",
          code: "NO_HANDLER_GROUPS",
          message: `No valid handler group exports found in: ${absoluteEntryPath}`,
          filePath: absoluteEntryPath,
        }),
      );
    }

    return new HandlerDiscoveryResult({
      entryPath: absoluteEntryPath,
      handlerGroups,
      diagnostics,
    });
  }

  private extractHandlerGroup(
    exportName: string,
    symbol: ts.Symbol,
    checker: ts.TypeChecker,
    diagnostics: ExtractionDiagnostic[],
  ): HandlerGroup | null {
    const declaration = symbol.valueDeclaration;
    if (!declaration) {
      return null;
    }

    if (!ts.isVariableDeclaration(declaration)) {
      this.addSkipDiagnostic(exportName, declaration, diagnostics);
      return null;
    }

    const initializer = declaration.initializer;
    if (!initializer || !ts.isCallExpression(initializer)) {
      this.addSkipDiagnostic(exportName, declaration, diagnostics);
      return null;
    }

    // Check for the double-call pattern: defineHandlers<TContract>()(handlers)
    // innerCall = the whole expression, outerCall = defineHandlers<TContract>()
    const innerCall = initializer;
    if (!ts.isCallExpression(innerCall.expression)) {
      this.addSkipDiagnostic(exportName, declaration, diagnostics);
      return null;
    }

    const outerCall = innerCall.expression;
    if (!this.isDefineHandlersCall(outerCall, checker)) {
      this.addSkipDiagnostic(exportName, declaration, diagnostics);
      return null;
    }

    // Extract TContract from the type arguments on the outer call
    const typeArgs = outerCall.typeArguments;
    if (!typeArgs || typeArgs.length === 0) {
      diagnostics.push(
        new ExtractionDiagnostic({
          severity: "warning",
          code: "MISSING_TYPE_ARGUMENT",
          message: `Export '${exportName}' calls defineHandlers without a type argument.`,
          filePath: declaration.getSourceFile().fileName,
        }),
      );
      return null;
    }

    const contractType = checker.getTypeFromTypeNode(typeArgs[0]);
    const contractName = this.getContractName(contractType, checker);
    if (!contractName) {
      diagnostics.push(
        new ExtractionDiagnostic({
          severity: "warning",
          code: "UNKNOWN_CONTRACT_NAME",
          message: `Export '${exportName}' has a contract type without a Contract<T> name.`,
          filePath: declaration.getSourceFile().fileName,
        }),
      );
      return null;
    }

    const contractSourcePath = this.getDeclarationSourcePath(contractType);
    if (!contractSourcePath) {
      diagnostics.push(
        new ExtractionDiagnostic({
          severity: "warning",
          code: "NO_CONTRACT_SOURCE",
          message: `Export '${exportName}' has a contract type with no resolvable source file.`,
          filePath: declaration.getSourceFile().fileName,
        }),
      );
      return null;
    }

    const handlerSourcePath = declaration.getSourceFile().fileName;

    const handlerType = checker.getTypeOfSymbol(symbol);
    const endpointNames = checker.getPropertiesOfType(handlerType).map((p) => p.name);

    return new HandlerGroup({
      exportName,
      contractName,
      contractSourcePath,
      handlerSourcePath,
      endpointNames,
    });
  }

  private isDefineHandlersCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
    const symbol = checker.getSymbolAtLocation(call.expression);
    if (!symbol) {
      return false;
    }
    const resolved = this.resolveAlias(symbol, checker);
    return resolved.name === "defineHandlers";
  }

  private getContractName(type: ts.Type, checker: ts.TypeChecker): string | null {
    const prop = type.getProperty("__contractName");
    if (!prop) {
      return null;
    }

    const propType = checker.getTypeOfSymbol(prop);
    if (propType.isStringLiteral()) {
      return propType.value;
    }

    if (propType.isUnion()) {
      for (const member of propType.types) {
        if (member.isStringLiteral()) {
          return member.value;
        }
      }
    }

    return null;
  }

  private getDeclarationSourcePath(type: ts.Type): string | null {
    const decl = type.symbol?.declarations?.[0];
    return decl ? decl.getSourceFile().fileName : null;
  }

  private resolveAlias(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
    return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  }

  private addSkipDiagnostic(
    exportName: string,
    node: ts.Node,
    diagnostics: ExtractionDiagnostic[],
  ): void {
    diagnostics.push(
      new ExtractionDiagnostic({
        severity: "warning",
        code: "NOT_HANDLER_GROUP",
        message: `Export '${exportName}' is not a defineHandlers result and was skipped.`,
        filePath: node.getSourceFile().fileName,
      }),
    );
  }
}
