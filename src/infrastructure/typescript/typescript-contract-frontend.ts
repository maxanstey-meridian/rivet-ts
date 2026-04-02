import path from "node:path";
import ts from "typescript";
import { TsContractFrontend } from "../../application/ports/ts-contract-frontend.js";
import { ContractBundle } from "../../domain/contract-bundle.js";
import {
  ContractSpec,
  EndpointSpec,
  ErrorResponseSpec,
  type HttpMethod,
} from "../../domain/contract.js";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import { TypeExpression } from "../../domain/type-expression.js";

const HTTP_METHODS = new Set<HttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const BUILTIN_TYPE_NAMES = new Set([
  "Array",
  "Record",
  "ReadonlyArray",
  "String",
  "Number",
  "Boolean",
  "Promise",
]);

export class TypeScriptContractFrontend extends TsContractFrontend {
  public async extract(entryPath: string): Promise<ContractBundle> {
    const absoluteEntryPath = path.resolve(entryPath);
    const compilerOptions: ts.CompilerOptions = {
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
      types: ["node"],
    };

    const program = ts.createProgram([absoluteEntryPath], compilerOptions);
    const sourceFile = program.getSourceFile(absoluteEntryPath);
    const diagnostics = this.createDiagnostics(program, absoluteEntryPath);

    if (!sourceFile) {
      diagnostics.push(
        new ExtractionDiagnostic({
          severity: "error",
          code: "ENTRY_NOT_FOUND",
          message: `Could not load entry file: ${absoluteEntryPath}`,
          filePath: absoluteEntryPath,
        }),
      );

      return new ContractBundle({
        entryPath: absoluteEntryPath,
        contracts: [],
        diagnostics,
      });
    }

    const referencedTypes = new Set<string>();
    const contracts: ContractSpec[] = [];

    for (const statement of sourceFile.statements) {
      if (!ts.isInterfaceDeclaration(statement)) {
        continue;
      }

      const contractName = this.getDeclaredContractName(statement);
      if (!contractName) {
        continue;
      }

      const endpoints: EndpointSpec[] = [];

      for (const member of statement.members) {
        if (!ts.isPropertySignature(member) || !member.type || !member.name) {
          continue;
        }

        const endpointName = this.getMemberName(member.name);
        if (!endpointName) {
          diagnostics.push(
            this.createNodeDiagnostic(
              sourceFile,
              member,
              "UNSUPPORTED_ENDPOINT_NAME",
              "Only identifier endpoint names are supported.",
            ),
          );
          continue;
        }

        const endpoint = this.parseEndpoint(member.type, endpointName, sourceFile, diagnostics);
        if (!endpoint) {
          continue;
        }

        this.collectEndpointReferences(endpoint, referencedTypes);
        endpoints.push(endpoint);
      }

      contracts.push(
        new ContractSpec({
          name: contractName,
          sourceFilePath: sourceFile.fileName,
          endpoints,
        }),
      );
    }

    return new ContractBundle({
      entryPath: absoluteEntryPath,
      contracts,
      referencedTypes: [...referencedTypes].sort(),
      diagnostics,
    });
  }

  private createDiagnostics(program: ts.Program, entryPath: string): ExtractionDiagnostic[] {
    return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
      if (!diagnostic.file || diagnostic.start === undefined) {
        return new ExtractionDiagnostic({
          severity: "error",
          code: "TS_COMPILER",
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
          filePath: entryPath,
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
  }

  private getDeclaredContractName(node: ts.InterfaceDeclaration): string | null {
    for (const clause of node.heritageClauses ?? []) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
        continue;
      }

      for (const type of clause.types) {
        if (type.expression.getText() !== "Contract") {
          continue;
        }

        const [firstArgument] = type.typeArguments ?? [];
        if (
          !firstArgument ||
          !ts.isLiteralTypeNode(firstArgument) ||
          !ts.isStringLiteral(firstArgument.literal)
        ) {
          return null;
        }

        return firstArgument.literal.text;
      }
    }

    return null;
  }

  private getMemberName(name: ts.PropertyName): string | null {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
      return name.text;
    }

    return null;
  }

  private parseEndpoint(
    typeNode: ts.TypeNode,
    endpointName: string,
    sourceFile: ts.SourceFile,
    diagnostics: ExtractionDiagnostic[],
  ): EndpointSpec | null {
    if (!ts.isTypeReferenceNode(typeNode) || typeNode.typeName.getText(sourceFile) !== "Endpoint") {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          typeNode,
          "UNSUPPORTED_ENDPOINT_TYPE",
          `Endpoint "${endpointName}" must use Endpoint<{ ... }>.`,
        ),
      );
      return null;
    }

    const [specNode] = typeNode.typeArguments ?? [];
    if (!specNode || !ts.isTypeLiteralNode(specNode)) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          typeNode,
          "INVALID_ENDPOINT_SPEC",
          `Endpoint "${endpointName}" must use a type literal spec.`,
        ),
      );
      return null;
    }

    const propertyMap = new Map<string, ts.TypeNode>();
    for (const member of specNode.members) {
      if (!ts.isPropertySignature(member) || !member.type || !member.name) {
        continue;
      }

      const memberName = this.getMemberName(member.name);
      if (!memberName) {
        continue;
      }

      propertyMap.set(memberName, member.type);
    }

    const method = this.parseHttpMethod(
      propertyMap.get("method"),
      sourceFile,
      diagnostics,
      endpointName,
    );
    const route = this.parseStringLiteral(propertyMap.get("route"), sourceFile);

    if (!method || !route) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          specNode,
          "INCOMPLETE_ENDPOINT",
          `Endpoint "${endpointName}" must declare both method and route.`,
        ),
      );
      return null;
    }

    const input = this.parseTypeExpression(propertyMap.get("input"), sourceFile);
    const response = this.parseTypeExpression(propertyMap.get("response"), sourceFile);
    const fileResponse =
      this.parseBooleanLiteral(propertyMap.get("fileResponse"), sourceFile) ?? false;
    const fileContentType = this.parseStringLiteral(propertyMap.get("fileContentType"), sourceFile);
    const successStatus = this.parseNumericLiteral(propertyMap.get("successStatus"), sourceFile);
    const summary = this.parseStringLiteral(propertyMap.get("summary"), sourceFile);
    const description = this.parseStringLiteral(propertyMap.get("description"), sourceFile);
    const anonymous = this.parseBooleanLiteral(propertyMap.get("anonymous"), sourceFile) ?? false;
    const securityScheme = this.parseSecurityScheme(propertyMap.get("security"), sourceFile);
    const errors = this.parseErrors(
      propertyMap.get("errors"),
      sourceFile,
      diagnostics,
      endpointName,
    );

    return new EndpointSpec({
      name: endpointName,
      method,
      route,
      input: input ?? undefined,
      response: response ?? undefined,
      fileResponse,
      fileContentType: fileContentType ?? undefined,
      successStatus: successStatus ?? undefined,
      summary: summary ?? undefined,
      description: description ?? undefined,
      errors,
      anonymous,
      securityScheme: securityScheme ?? undefined,
    });
  }

  private parseHttpMethod(
    node: ts.TypeNode | undefined,
    sourceFile: ts.SourceFile,
    diagnostics: ExtractionDiagnostic[],
    endpointName: string,
  ): HttpMethod | null {
    const method = this.parseStringLiteral(node, sourceFile);
    if (!method) {
      return null;
    }

    if (!HTTP_METHODS.has(method as HttpMethod)) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          node!,
          "UNSUPPORTED_HTTP_METHOD",
          `Endpoint "${endpointName}" uses unsupported HTTP method "${method}".`,
        ),
      );
      return null;
    }

    return method as HttpMethod;
  }

  private parseErrors(
    node: ts.TypeNode | undefined,
    sourceFile: ts.SourceFile,
    diagnostics: ExtractionDiagnostic[],
    endpointName: string,
  ): ErrorResponseSpec[] {
    if (!node) {
      return [];
    }

    if (!ts.isTupleTypeNode(node)) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          node,
          "INVALID_ERRORS_SPEC",
          `Endpoint "${endpointName}" must declare errors as a tuple type.`,
        ),
      );
      return [];
    }

    const errors: ErrorResponseSpec[] = [];
    for (const element of node.elements) {
      if (!ts.isTypeLiteralNode(element)) {
        diagnostics.push(
          this.createNodeDiagnostic(
            sourceFile,
            element,
            "INVALID_ERROR_ENTRY",
            `Endpoint "${endpointName}" has an error entry that is not an object type.`,
          ),
        );
        continue;
      }

      const propertyMap = new Map<string, ts.TypeNode>();
      for (const member of element.members) {
        if (!ts.isPropertySignature(member) || !member.type || !member.name) {
          continue;
        }

        const memberName = this.getMemberName(member.name);
        if (!memberName) {
          continue;
        }

        propertyMap.set(memberName, member.type);
      }

      const status = this.parseNumericLiteral(propertyMap.get("status"), sourceFile);
      if (status === null) {
        diagnostics.push(
          this.createNodeDiagnostic(
            sourceFile,
            element,
            "MISSING_ERROR_STATUS",
            `Endpoint "${endpointName}" has an error entry without a numeric status.`,
          ),
        );
        continue;
      }

      errors.push(
        new ErrorResponseSpec({
          status,
          response: this.parseTypeExpression(propertyMap.get("response"), sourceFile) ?? undefined,
          description:
            this.parseStringLiteral(propertyMap.get("description"), sourceFile) ?? undefined,
        }),
      );
    }

    return errors;
  }

  private parseSecurityScheme(
    node: ts.TypeNode | undefined,
    sourceFile: ts.SourceFile,
  ): string | null {
    if (!node || !ts.isTypeLiteralNode(node)) {
      return null;
    }

    for (const member of node.members) {
      if (!ts.isPropertySignature(member) || !member.type || !member.name) {
        continue;
      }

      const memberName = this.getMemberName(member.name);
      if (memberName !== "scheme") {
        continue;
      }

      return this.parseStringLiteral(member.type, sourceFile);
    }

    return null;
  }

  private parseStringLiteral(
    node: ts.TypeNode | undefined,
    _sourceFile: ts.SourceFile,
  ): string | null {
    if (!node || !ts.isLiteralTypeNode(node) || !ts.isStringLiteral(node.literal)) {
      return null;
    }

    return node.literal.text;
  }

  private parseNumericLiteral(
    node: ts.TypeNode | undefined,
    sourceFile: ts.SourceFile,
  ): number | null {
    if (!node || !ts.isLiteralTypeNode(node) || !ts.isNumericLiteral(node.literal)) {
      return null;
    }

    return Number.parseInt(node.literal.getText(sourceFile), 10);
  }

  private parseBooleanLiteral(
    node: ts.TypeNode | undefined,
    _sourceFile: ts.SourceFile,
  ): boolean | null {
    if (!node || !ts.isLiteralTypeNode(node)) {
      return null;
    }

    if (node.literal.kind === ts.SyntaxKind.TrueKeyword) {
      return true;
    }

    if (node.literal.kind === ts.SyntaxKind.FalseKeyword) {
      return false;
    }

    return null;
  }

  private parseTypeExpression(
    node: ts.TypeNode | undefined,
    sourceFile: ts.SourceFile,
  ): TypeExpression | null {
    if (!node || node.kind === ts.SyntaxKind.VoidKeyword) {
      return null;
    }

    const references = new Set<string>();
    this.collectTypeReferences(node, references, sourceFile);

    return new TypeExpression(node.getText(sourceFile), [...references].sort());
  }

  private collectTypeReferences(
    node: ts.TypeNode,
    references: Set<string>,
    sourceFile: ts.SourceFile,
  ): void {
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText(sourceFile);
      if (!BUILTIN_TYPE_NAMES.has(name)) {
        references.add(name);
      }

      for (const typeArgument of node.typeArguments ?? []) {
        this.collectTypeReferences(typeArgument, references, sourceFile);
      }
      return;
    }

    if (ts.isArrayTypeNode(node)) {
      this.collectTypeReferences(node.elementType, references, sourceFile);
      return;
    }

    if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
      for (const member of node.types) {
        this.collectTypeReferences(member, references, sourceFile);
      }
      return;
    }

    if (ts.isTupleTypeNode(node)) {
      for (const member of node.elements) {
        this.collectTypeReferences(member, references, sourceFile);
      }
      return;
    }

    if (ts.isParenthesizedTypeNode(node) || ts.isTypeOperatorNode(node)) {
      this.collectTypeReferences(node.type, references, sourceFile);
      return;
    }

    if (ts.isTypeLiteralNode(node)) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.type) {
          this.collectTypeReferences(member.type, references, sourceFile);
        }
      }
      return;
    }
  }

  private collectEndpointReferences(endpoint: EndpointSpec, references: Set<string>): void {
    for (const symbol of endpoint.input?.referencedSymbols ?? []) {
      references.add(symbol);
    }

    for (const symbol of endpoint.response?.referencedSymbols ?? []) {
      references.add(symbol);
    }

    for (const error of endpoint.errors) {
      for (const symbol of error.response?.referencedSymbols ?? []) {
        references.add(symbol);
      }
    }
  }

  private createNodeDiagnostic(
    sourceFile: ts.SourceFile,
    node: ts.Node,
    code: string,
    message: string,
  ): ExtractionDiagnostic {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

    return new ExtractionDiagnostic({
      severity: "error",
      code,
      message,
      filePath: sourceFile.fileName,
      line: position.line + 1,
      column: position.character + 1,
    });
  }
}
