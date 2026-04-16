import path from "node:path";
import ts from "typescript";
import { TsContractFrontend } from "../../application/ports/ts-contract-frontend.js";
import { ContractBundle } from "../../domain/contract-bundle.js";
import {
  ContractSpec,
  EndpointExampleSpec,
  type EndpointExampleValue,
  EndpointSpec,
  ErrorResponseSpec,
  ResponseExamplesSpec,
  SecuritySpec,
  type HttpMethod,
} from "../../domain/contract.js";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import { TypeExpression } from "../../domain/type-expression.js";
import {
  mapTypeScriptDiagnostics,
  resolveTypeScriptProject,
} from "./typescript-project.js";

const HTTP_METHODS = new Set<HttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const AUTHORING_HELPER_TYPE_NAMES = new Set([
  "EndpointAuthoringSpec",
  "EndpointErrorAuthoringSpec",
  "EndpointSecurityAuthoringSpec",
]);
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
  public constructor(private readonly tsconfigPath?: string) {
    super();
  }

  public async extract(entryPath: string): Promise<ContractBundle> {
    const project = resolveTypeScriptProject(entryPath, this.tsconfigPath);
    const absoluteEntryPath = project.absoluteEntryPath;
    const program = ts.createProgram([absoluteEntryPath], project.compilerOptions);
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(absoluteEntryPath);
    const diagnostics = [
      ...mapTypeScriptDiagnostics(project.configDiagnostics, absoluteEntryPath),
      ...this.createDiagnostics(program, absoluteEntryPath),
    ];

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

        const endpoint = this.parseEndpoint(
          member.type,
          endpointName,
          sourceFile,
          checker,
          diagnostics,
        );
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
    return mapTypeScriptDiagnostics(ts.getPreEmitDiagnostics(program), entryPath);
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
    checker: ts.TypeChecker,
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
    if (!specNode) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          typeNode,
          "INVALID_ENDPOINT_SPEC",
          `Endpoint "${endpointName}" must declare an endpoint authoring spec.`,
        ),
      );
      return null;
    }

    const propertyMap = this.createPropertyMap(specNode, sourceFile, checker);
    if (!propertyMap) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          typeNode,
          "INVALID_ENDPOINT_SPEC",
          `Endpoint "${endpointName}" must use a type literal spec or a type alias that resolves to one.`,
        ),
      );
      return null;
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
    const requestExamples = this.parseRequestExamples(
      propertyMap.get("requestExamples"),
      propertyMap.get("requestExample"),
      propertyMap.get("input"),
      sourceFile,
      checker,
      diagnostics,
      endpointName,
    );
    const fileResponse =
      this.parseBooleanLiteral(propertyMap.get("fileResponse"), sourceFile) ?? false;
    const fileContentType = this.parseStringLiteral(propertyMap.get("fileContentType"), sourceFile);
    const queryAuthNode = propertyMap.get("queryAuth");
    const queryAuthBool = this.parseBooleanLiteral(queryAuthNode, sourceFile);
    const queryAuthString = this.parseStringLiteral(queryAuthNode, sourceFile);
    const queryAuth = queryAuthBool === true ? "token" : (queryAuthString ?? undefined);
    const formEncoded =
      this.parseBooleanLiteral(propertyMap.get("formEncoded"), sourceFile) ?? false;
    const acceptsFile =
      this.parseBooleanLiteral(propertyMap.get("acceptsFile"), sourceFile) ?? false;
    const successStatus = this.parseNumericLiteral(propertyMap.get("successStatus"), sourceFile);
    const responseExamples = this.parseResponseExamples(
      propertyMap.get("responseExamples"),
      propertyMap.get("successResponseExample"),
      propertyMap.get("response"),
      method,
      successStatus,
      sourceFile,
      checker,
      diagnostics,
      endpointName,
    );
    const summary = this.parseStringLiteral(propertyMap.get("summary"), sourceFile);
    const description = this.parseStringLiteral(propertyMap.get("description"), sourceFile);
    const anonymous = this.parseBooleanLiteral(propertyMap.get("anonymous"), sourceFile) ?? false;
    const securityScheme = this.parseSecurityScheme(
      propertyMap.get("security"),
      sourceFile,
      checker,
      diagnostics,
      endpointName,
    );
    const errors = this.parseErrors(
      propertyMap.get("errors"),
      sourceFile,
      checker,
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
      formEncoded,
      acceptsFile,
      successStatus: successStatus ?? undefined,
      summary: summary ?? undefined,
      description: description ?? undefined,
      requestExamples,
      responseExamples,
      errors,
      anonymous,
      security: securityScheme ? new SecuritySpec({ scheme: securityScheme }) : undefined,
      queryAuth,
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
    checker: ts.TypeChecker,
    diagnostics: ExtractionDiagnostic[],
    endpointName: string,
  ): ErrorResponseSpec[] {
    if (!node) {
      return [];
    }

    const errorEntries = this.getErrorEntryNodes(node, checker);
    if (!errorEntries) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          node,
          "INVALID_ERRORS_SPEC",
          `Endpoint "${endpointName}" must declare errors as an array or tuple type.`,
        ),
      );
      return [];
    }

    const errors: ErrorResponseSpec[] = [];
    for (const element of errorEntries) {
      const propertyMap = this.createPropertyMap(element, sourceFile, checker);
      if (!propertyMap) {
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

  private parseRequestExamples(
    pluralNode: ts.TypeNode | undefined,
    singularNode: ts.TypeNode | undefined,
    targetNode: ts.TypeNode | undefined,
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    diagnostics: ExtractionDiagnostic[],
    endpointName: string,
  ): EndpointExampleSpec[] {
    if (pluralNode && singularNode) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          pluralNode,
          "CONFLICTING_REQUEST_EXAMPLE_SPEC",
          `Endpoint "${endpointName}" cannot declare both requestExample and requestExamples.`,
        ),
      );
      return [];
    }

    if (pluralNode) {
      const entryNodes = this.getRequestExampleEntryNodes(pluralNode, checker);
      if (!entryNodes) {
        diagnostics.push(
          this.createNodeDiagnostic(
            sourceFile,
            pluralNode,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" must declare requestExamples as an array of typeof exportedConst entries or { json: typeof exportedConst } descriptors.`,
          ),
        );
        return [];
      }

      const examples: EndpointExampleSpec[] = [];
      for (const entryNode of entryNodes) {
        const example = this.parseRequestExampleEntry(
          entryNode,
          targetNode,
          sourceFile,
          checker,
          diagnostics,
          endpointName,
        );
        if (example) {
          examples.push(example);
        }
      }

      return examples;
    }

    const requestExample = this.parseEndpointExample(
      singularNode,
      targetNode,
      "requestExample",
      "input",
      sourceFile,
      checker,
      diagnostics,
      endpointName,
    );

    return requestExample ? [requestExample] : [];
  }

  private parseResponseExamples(
    pluralNode: ts.TypeNode | undefined,
    legacySingularNode: ts.TypeNode | undefined,
    targetNode: ts.TypeNode | undefined,
    method: HttpMethod,
    successStatus: number | null,
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    diagnostics: ExtractionDiagnostic[],
    endpointName: string,
  ): ResponseExamplesSpec[] {
    if (pluralNode && legacySingularNode) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          pluralNode,
          "CONFLICTING_RESPONSE_EXAMPLE_SPEC",
          `Endpoint "${endpointName}" cannot declare both successResponseExample and responseExamples.`,
        ),
      );
      return [];
    }

    if (pluralNode) {
      const entryNodes = this.getRequestExampleEntryNodes(pluralNode, checker);
      if (!entryNodes) {
        diagnostics.push(
          this.createNodeDiagnostic(
            sourceFile,
            pluralNode,
            "INVALID_RESPONSE_EXAMPLES_SPEC",
            `Endpoint "${endpointName}" must declare responseExamples as an array of { status; examples } entries.`,
          ),
        );
        return [];
      }

      const result: ResponseExamplesSpec[] = [];
      for (const entryNode of entryNodes) {
        const parsed = this.parseResponseExamplesEntry(
          entryNode,
          targetNode,
          sourceFile,
          checker,
          diagnostics,
          endpointName,
        );
        if (parsed) {
          result.push(parsed);
        }
      }

      return result;
    }

    if (legacySingularNode) {
      const legacyExample = this.parseEndpointExample(
        legacySingularNode,
        targetNode,
        "successResponseExample",
        "response",
        sourceFile,
        checker,
        diagnostics,
        endpointName,
      );

      if (!legacyExample) {
        return [];
      }

      const resolvedStatus = successStatus ?? this.getDefaultSuccessStatus(method);
      return [new ResponseExamplesSpec({ status: resolvedStatus, examples: [legacyExample] })];
    }

    return [];
  }

  private parseResponseExamplesEntry(
    node: ts.TypeNode,
    targetNode: ts.TypeNode | undefined,
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    diagnostics: ExtractionDiagnostic[],
    endpointName: string,
  ): ResponseExamplesSpec | null {
    const propertyMap = this.createPropertyMap(node, sourceFile, checker);
    if (!propertyMap) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          node,
          "INVALID_RESPONSE_EXAMPLES_ENTRY",
          `Endpoint "${endpointName}" responseExamples entries must be { status; examples } objects.`,
        ),
      );
      return null;
    }

    const status = this.parseNumericLiteral(propertyMap.get("status"), sourceFile);
    if (status === null) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          node,
          "MISSING_RESPONSE_EXAMPLE_STATUS",
          `Endpoint "${endpointName}" responseExamples entry must declare a numeric status.`,
        ),
      );
      return null;
    }

    const examplesNode = propertyMap.get("examples");
    if (!examplesNode) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          node,
          "MISSING_RESPONSE_EXAMPLES",
          `Endpoint "${endpointName}" responseExamples entry for status ${status} must declare an examples array.`,
        ),
      );
      return null;
    }

    const exampleEntryNodes = this.getRequestExampleEntryNodes(examplesNode, checker);
    if (!exampleEntryNodes) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          examplesNode,
          "INVALID_RESPONSE_EXAMPLES",
          `Endpoint "${endpointName}" responseExamples entry for status ${status} must declare examples as an array of typeof exportedConst entries.`,
        ),
      );
      return null;
    }

    const examples: EndpointExampleSpec[] = [];
    for (const exampleNode of exampleEntryNodes) {
      const example = this.parseResponseExampleEntry(
        exampleNode,
        `responseExamples[${status}].examples entries`,
        sourceFile,
        checker,
        diagnostics,
        endpointName,
      );
      if (example) {
        examples.push(example);
      }
    }

    return new ResponseExamplesSpec({ status, examples });
  }

  private parseResponseExampleEntry(
    node: ts.TypeNode,
    propertyName: string,
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    diagnostics: ExtractionDiagnostic[],
    endpointName: string,
  ): EndpointExampleSpec | null {
    if (ts.isTypeQueryNode(node)) {
      const declaration = this.resolveExampleDeclaration(node.exprName, checker);
      if (
        !declaration ||
        !declaration.initializer ||
        !this.isConstVariableDeclaration(declaration) ||
        !this.isExportedVariableDeclaration(declaration)
      ) {
        diagnostics.push(
          this.createNodeDiagnostic(
            sourceFile,
            node,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" must declare ${propertyName} as typeof an exported const with an initializer.`,
          ),
        );
        return null;
      }

      const data = this.parseExampleValue(declaration.initializer, checker);
      if (data === undefined) {
        diagnostics.push(
          this.createNodeDiagnostic(
            sourceFile,
            declaration.initializer,
            "UNSUPPORTED_ENDPOINT_EXAMPLE_VALUE",
            `Endpoint "${endpointName}" ${propertyName} must resolve to a JSON-like const initializer.`,
          ),
        );
        return null;
      }

      return new EndpointExampleSpec({ data });
    }

    const propertyMap = this.createPropertyMap(node, sourceFile, checker);
    if (!propertyMap) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" ${propertyName} must be typeof exportedConst or a supported descriptor object.`,
        ),
      );
      return null;
    }

    const name = this.parseRequestExampleDescriptorStringLiteral(
      propertyMap.get("name"),
      "name",
      sourceFile,
      diagnostics,
      endpointName,
    );
    const mediaType = this.parseRequestExampleDescriptorStringLiteral(
      propertyMap.get("mediaType"),
      "mediaType",
      sourceFile,
      diagnostics,
      endpointName,
    );

    if (name === null || mediaType === null) {
      return null;
    }

    const jsonNode = propertyMap.get("json");
    const componentExampleIdNode = propertyMap.get("componentExampleId");
    const resolvedJsonNode = propertyMap.get("resolvedJson");

    if (jsonNode) {
      if (componentExampleIdNode || resolvedJsonNode) {
        diagnostics.push(
          this.createNodeDiagnostic(
            sourceFile,
            node,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" ${propertyName} must use either inline json or ref-backed componentExampleId/resolvedJson fields, not both.`,
          ),
        );
        return null;
      }

      const data = this.parseResponseExampleData(
        jsonNode,
        `${propertyName}.json`,
        sourceFile,
        checker,
        diagnostics,
        endpointName,
      );
      if (data === null) {
        return null;
      }

      return new EndpointExampleSpec({
        data,
        name: name ?? undefined,
        mediaType: mediaType ?? undefined,
      });
    }

    if (componentExampleIdNode || resolvedJsonNode) {
      if (!componentExampleIdNode || !resolvedJsonNode) {
        diagnostics.push(
          this.createNodeDiagnostic(
            sourceFile,
            node,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" ref-backed ${propertyName} must declare both componentExampleId and resolvedJson.`,
          ),
        );
        return null;
      }

      const componentExampleId = this.parseStringLiteral(componentExampleIdNode, sourceFile);
      if (!componentExampleId) {
        diagnostics.push(
          this.createNodeDiagnostic(
            sourceFile,
            componentExampleIdNode,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" ${propertyName} must declare componentExampleId as a string literal.`,
          ),
        );
        return null;
      }

      const resolvedJson = this.parseResponseExampleData(
        resolvedJsonNode,
        `${propertyName}.resolvedJson`,
        sourceFile,
        checker,
        diagnostics,
        endpointName,
      );
      if (resolvedJson === null) {
        return null;
      }

      return new EndpointExampleSpec({
        componentExampleId,
        resolvedJson,
        name: name ?? undefined,
        mediaType: mediaType ?? undefined,
      });
    }

    diagnostics.push(
      this.createNodeDiagnostic(
        sourceFile,
        node,
        "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
        `Endpoint "${endpointName}" ${propertyName} descriptor must declare json or componentExampleId/resolvedJson.`,
      ),
    );
    return null;
  }

  private parseResponseExampleData(
    node: ts.TypeNode,
    propertyName: string,
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    diagnostics: ExtractionDiagnostic[],
    endpointName: string,
  ): EndpointExampleValue | null {
    if (!ts.isTypeQueryNode(node)) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" must declare ${propertyName} as typeof exportedConst.`,
        ),
      );
      return null;
    }

    const declaration = this.resolveExampleDeclaration(node.exprName, checker);
    if (
      !declaration ||
      !declaration.initializer ||
      !this.isConstVariableDeclaration(declaration) ||
      !this.isExportedVariableDeclaration(declaration)
    ) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" must declare ${propertyName} as typeof an exported const with an initializer.`,
        ),
      );
      return null;
    }

    const data = this.parseExampleValue(declaration.initializer, checker);
    if (data === undefined) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          declaration.initializer,
          "UNSUPPORTED_ENDPOINT_EXAMPLE_VALUE",
          `Endpoint "${endpointName}" ${propertyName} must resolve to a JSON-like const initializer.`,
        ),
      );
      return null;
    }

    return data;
  }

  private getDefaultSuccessStatus(method: HttpMethod): number {
    switch (method) {
      case "DELETE":
        return 204;
      case "POST":
        return 201;
      default:
        return 200;
    }
  }

  private parseRequestExampleEntry(
    node: ts.TypeNode,
    targetNode: ts.TypeNode | undefined,
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    diagnostics: ExtractionDiagnostic[],
    endpointName: string,
  ): EndpointExampleSpec | null {
    if (ts.isTypeQueryNode(node)) {
      return this.parseEndpointExample(
        node,
        targetNode,
        "requestExamples entries",
        "input",
        sourceFile,
        checker,
        diagnostics,
        endpointName,
      );
    }

    const propertyMap = this.createPropertyMap(node, sourceFile, checker);
    if (!propertyMap) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" requestExamples entries must be typeof exportedConst or a supported descriptor object.`,
        ),
      );
      return null;
    }

    const name = this.parseRequestExampleDescriptorStringLiteral(
      propertyMap.get("name"),
      "name",
      sourceFile,
      diagnostics,
      endpointName,
    );
    const mediaType = this.parseRequestExampleDescriptorStringLiteral(
      propertyMap.get("mediaType"),
      "mediaType",
      sourceFile,
      diagnostics,
      endpointName,
    );

    if (name === null || mediaType === null) {
      return null;
    }

    const jsonNode = propertyMap.get("json");
    const componentExampleIdNode = propertyMap.get("componentExampleId");
    const resolvedJsonNode = propertyMap.get("resolvedJson");

    if (jsonNode) {
      if (componentExampleIdNode || resolvedJsonNode) {
        diagnostics.push(
          this.createNodeDiagnostic(
            sourceFile,
            node,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" requestExamples entries must use either inline json or ref-backed componentExampleId/resolvedJson fields, not both.`,
          ),
        );
        return null;
      }

      const data = this.parseEndpointExampleData(
        jsonNode,
        targetNode,
        "requestExamples entries.json",
        "input",
        sourceFile,
        checker,
        diagnostics,
        endpointName,
      );
      if (data === null) {
        return null;
      }

      return new EndpointExampleSpec({
        data,
        name: name ?? undefined,
        mediaType: mediaType ?? undefined,
      });
    }

    if (componentExampleIdNode || resolvedJsonNode) {
      if (!componentExampleIdNode || !resolvedJsonNode) {
        diagnostics.push(
          this.createNodeDiagnostic(
            sourceFile,
            node,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" ref-backed requestExamples entries must declare both componentExampleId and resolvedJson.`,
          ),
        );
        return null;
      }

      const componentExampleId = this.parseStringLiteral(componentExampleIdNode, sourceFile);
      if (!componentExampleId) {
        diagnostics.push(
          this.createNodeDiagnostic(
            sourceFile,
            componentExampleIdNode,
            "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
            `Endpoint "${endpointName}" requestExamples entries must declare componentExampleId as a string literal.`,
          ),
        );
        return null;
      }

      const resolvedJson = this.parseEndpointExampleData(
        resolvedJsonNode,
        targetNode,
        "requestExamples entries.resolvedJson",
        "input",
        sourceFile,
        checker,
        diagnostics,
        endpointName,
      );
      if (resolvedJson === null) {
        return null;
      }

      return new EndpointExampleSpec({
        componentExampleId,
        resolvedJson,
        name: name ?? undefined,
        mediaType: mediaType ?? undefined,
      });
    }

    diagnostics.push(
      this.createNodeDiagnostic(
        sourceFile,
        node,
        "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
        `Endpoint "${endpointName}" requestExamples entries must be typeof exportedConst, { json: typeof exportedConst }, or { componentExampleId: "..."; resolvedJson: typeof exportedConst }.`,
      ),
    );
    return null;
  }

  private parseEndpointExample(
    node: ts.TypeNode | undefined,
    targetNode: ts.TypeNode | undefined,
    propertyName: string,
    targetPropertyName: "input" | "response",
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    diagnostics: ExtractionDiagnostic[],
    endpointName: string,
  ): EndpointExampleSpec | null {
    const data = this.parseEndpointExampleData(
      node,
      targetNode,
      propertyName,
      targetPropertyName,
      sourceFile,
      checker,
      diagnostics,
      endpointName,
    );

    return data === null ? null : new EndpointExampleSpec({ data });
  }

  private parseEndpointExampleData(
    node: ts.TypeNode | undefined,
    targetNode: ts.TypeNode | undefined,
    propertyName: string,
    targetPropertyName: "input" | "response",
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    diagnostics: ExtractionDiagnostic[],
    endpointName: string,
  ): EndpointExampleValue | null {
    if (!node) {
      return null;
    }

    if (!ts.isTypeQueryNode(node)) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" must declare ${propertyName} as typeof exportedConst.`,
        ),
      );
      return null;
    }

    const declaration = this.resolveExampleDeclaration(node.exprName, checker);
    if (
      !declaration ||
      !declaration.initializer ||
      !this.isConstVariableDeclaration(declaration) ||
      !this.isExportedVariableDeclaration(declaration)
    ) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          node,
          "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          `Endpoint "${endpointName}" must declare ${propertyName} as typeof an exported const with an initializer.`,
        ),
      );
      return null;
    }

    if (!targetNode) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          node,
          "INVALID_ENDPOINT_EXAMPLE_TYPE",
          `Endpoint "${endpointName}" ${propertyName} requires the corresponding endpoint ${targetPropertyName} type.`,
        ),
      );
      return null;
    }

    const data = this.parseExampleValue(declaration.initializer, checker);
    if (data === undefined) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          declaration.initializer,
          "UNSUPPORTED_ENDPOINT_EXAMPLE_VALUE",
          `Endpoint "${endpointName}" ${propertyName} must resolve to a JSON-like const initializer.`,
        ),
      );
      return null;
    }

    const exampleType = checker.getTypeFromTypeNode(node);
    const targetType = checker.getTypeFromTypeNode(targetNode);
    if (!checker.isTypeAssignableTo(exampleType, targetType)) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          node,
          "INVALID_ENDPOINT_EXAMPLE_TYPE",
          `Endpoint "${endpointName}" ${propertyName} must be assignable to the endpoint ${targetPropertyName} type.`,
        ),
      );
      return null;
    }

    return data;
  }

  private parseRequestExampleDescriptorStringLiteral(
    node: ts.TypeNode | undefined,
    propertyName: "name" | "mediaType",
    sourceFile: ts.SourceFile,
    diagnostics: ExtractionDiagnostic[],
    endpointName: string,
  ): string | null | undefined {
    if (!node) {
      return undefined;
    }

    const value = this.parseStringLiteral(node, sourceFile);
    if (value !== null) {
      return value;
    }

    diagnostics.push(
      this.createNodeDiagnostic(
        sourceFile,
        node,
        "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
        `Endpoint "${endpointName}" requestExamples entries must declare ${propertyName} as a string literal when provided.`,
      ),
    );
    return null;
  }

  private createPropertyMap(
    typeNode: ts.TypeNode,
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
  ): Map<string, ts.TypeNode> | null {
    if (ts.isTypeLiteralNode(typeNode)) {
      return this.createPropertyMapFromTypeLiteral(typeNode);
    }

    const specType = checker.getTypeFromTypeNode(typeNode);
    if ((specType.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) === 0) {
      return null;
    }

    const propertyMap = new Map<string, ts.TypeNode>();
    for (const propertySymbol of checker.getApparentType(specType).getProperties()) {
      const propertyTypeNode = this.selectPropertyTypeNode(propertySymbol, sourceFile);
      if (!propertyTypeNode) {
        continue;
      }

      propertyMap.set(propertySymbol.getName(), propertyTypeNode);
    }

    return propertyMap;
  }

  private getErrorEntryNodes(node: ts.TypeNode, checker: ts.TypeChecker): ts.TypeNode[] | null {
    if (ts.isParenthesizedTypeNode(node)) {
      return this.getErrorEntryNodes(node.type, checker);
    }

    if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
      return this.getErrorEntryNodes(node.type, checker);
    }

    if (ts.isTupleTypeNode(node)) {
      return [...node.elements];
    }

    if (ts.isArrayTypeNode(node)) {
      return [node.elementType];
    }

    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      BUILTIN_TYPE_NAMES.has(node.typeName.text)
    ) {
      const [elementType] = node.typeArguments ?? [];
      return elementType ? [elementType] : null;
    }

    const resolvedNode = this.resolveAliasedTypeNode(node, checker);
    return resolvedNode ? this.getErrorEntryNodes(resolvedNode, checker) : null;
  }

  private getRequestExampleEntryNodes(
    node: ts.TypeNode,
    checker: ts.TypeChecker,
  ): ts.TypeNode[] | null {
    if (ts.isParenthesizedTypeNode(node)) {
      return this.getRequestExampleEntryNodes(node.type, checker);
    }

    if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
      return this.getRequestExampleEntryNodes(node.type, checker);
    }

    if (ts.isTupleTypeNode(node)) {
      return [...node.elements];
    }

    if (ts.isArrayTypeNode(node)) {
      return [node.elementType];
    }

    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      BUILTIN_TYPE_NAMES.has(node.typeName.text)
    ) {
      const [elementType] = node.typeArguments ?? [];
      return elementType ? [elementType] : null;
    }

    const resolvedNode = this.resolveAliasedTypeNode(node, checker);
    return resolvedNode ? this.getRequestExampleEntryNodes(resolvedNode, checker) : null;
  }

  private resolveAliasedTypeNode(node: ts.TypeNode, checker?: ts.TypeChecker): ts.TypeNode | null {
    if (ts.isParenthesizedTypeNode(node)) {
      return this.resolveAliasedTypeNode(node.type, checker);
    }

    if (!ts.isTypeReferenceNode(node)) {
      return null;
    }

    const symbol = checker?.getSymbolAtLocation(node.typeName);
    const declarations = symbol?.getDeclarations() ?? [];
    for (const declaration of declarations) {
      if (ts.isTypeAliasDeclaration(declaration)) {
        return declaration.type;
      }
    }

    return null;
  }

  private resolveExampleDeclaration(
    entityName: ts.EntityName,
    checker: ts.TypeChecker,
  ): ts.VariableDeclaration | null {
    const symbol = checker.getSymbolAtLocation(entityName);
    if (!symbol) {
      return null;
    }

    const resolvedSymbol =
      (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;

    for (const declaration of resolvedSymbol.getDeclarations() ?? []) {
      if (ts.isVariableDeclaration(declaration)) {
        return declaration;
      }
    }

    return null;
  }

  private isConstVariableDeclaration(declaration: ts.VariableDeclaration): boolean {
    return (
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0
    );
  }

  private isExportedVariableDeclaration(declaration: ts.VariableDeclaration): boolean {
    return (
      ts.isVariableDeclarationList(declaration.parent) &&
      ts.isVariableStatement(declaration.parent.parent) &&
      (declaration.parent.parent.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) ??
        false)
    );
  }

  private parseExampleValue(
    expression: ts.Expression,
    checker: ts.TypeChecker,
  ): EndpointExampleValue | undefined {
    const unwrapped = this.unwrapExampleExpression(expression);

    if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
      return unwrapped.text;
    }

    if (ts.isNumericLiteral(unwrapped)) {
      return Number(unwrapped.text);
    }

    if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) {
      return true;
    }

    if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) {
      return false;
    }

    if (unwrapped.kind === ts.SyntaxKind.NullKeyword) {
      return null;
    }

    if (ts.isPrefixUnaryExpression(unwrapped)) {
      const operand = this.parseExampleValue(unwrapped.operand, checker);
      if (typeof operand !== "number") {
        return undefined;
      }

      if (unwrapped.operator === ts.SyntaxKind.MinusToken) {
        return -operand;
      }

      if (unwrapped.operator === ts.SyntaxKind.PlusToken) {
        return operand;
      }

      return undefined;
    }

    if (ts.isArrayLiteralExpression(unwrapped)) {
      const values: EndpointExampleValue[] = [];
      for (const element of unwrapped.elements) {
        if (ts.isSpreadElement(element)) {
          return undefined;
        }

        const value = this.parseExampleValue(element, checker);
        if (value === undefined) {
          return undefined;
        }

        values.push(value);
      }

      return values;
    }

    if (ts.isObjectLiteralExpression(unwrapped)) {
      const value: Record<string, EndpointExampleValue> = {};
      for (const property of unwrapped.properties) {
        const entry = this.parseExampleObjectProperty(property, checker);
        if (!entry) {
          return undefined;
        }

        value[entry.name] = entry.value;
      }

      return value;
    }

    if (ts.isIdentifier(unwrapped)) {
      return this.resolveIdentifierExampleValue(unwrapped, checker);
    }

    if (
      ts.isBinaryExpression(unwrapped) &&
      unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = this.parseExampleValue(unwrapped.left, checker);
      const right = this.parseExampleValue(unwrapped.right, checker);
      if (typeof left === "string" && typeof right === "string") {
        return left + right;
      }

      return undefined;
    }

    const literalValue = this.parseLiteralValueFromType(unwrapped, checker);
    return literalValue;
  }

  private resolveIdentifierExampleValue(
    identifier: ts.Identifier,
    checker: ts.TypeChecker,
  ): EndpointExampleValue | undefined {
    const symbol = checker.getSymbolAtLocation(identifier);
    if (!symbol) {
      return undefined;
    }

    const resolvedSymbol =
      (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;

    for (const declaration of resolvedSymbol.getDeclarations() ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return this.parseExampleValue(declaration.initializer, checker);
      }
    }

    return undefined;
  }

  private parseExampleObjectProperty(
    property: ts.ObjectLiteralElementLike,
    checker: ts.TypeChecker,
  ): { name: string; value: EndpointExampleValue } | null {
    if (ts.isPropertyAssignment(property)) {
      const propertyName = this.getExamplePropertyName(property.name);
      if (!propertyName) {
        return null;
      }

      const propertyValue = this.parseExampleValue(property.initializer, checker);
      return propertyValue === undefined ? null : { name: propertyName, value: propertyValue };
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      const propertyValue = this.parseShorthandExampleValue(property, checker);
      return propertyValue === undefined
        ? null
        : { name: property.name.text, value: propertyValue };
    }

    return null;
  }

  private parseShorthandExampleValue(
    property: ts.ShorthandPropertyAssignment,
    checker: ts.TypeChecker,
  ): EndpointExampleValue | undefined {
    const symbol = checker.getShorthandAssignmentValueSymbol(property);
    if (!symbol) {
      return undefined;
    }

    const resolvedSymbol =
      (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;

    for (const declaration of resolvedSymbol.getDeclarations() ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return this.parseExampleValue(declaration.initializer, checker);
      }
    }

    return this.parseLiteralValueFromTsType(
      checker.getTypeOfSymbolAtLocation(resolvedSymbol, property.name),
      checker,
    );
  }

  private unwrapExampleExpression(expression: ts.Expression): ts.Expression {
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isTypeAssertionExpression(expression)
    ) {
      return this.unwrapExampleExpression(expression.expression);
    }

    return expression;
  }

  private getExamplePropertyName(name: ts.PropertyName): string | null {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }

    return null;
  }

  private parseLiteralValueFromType(
    expression: ts.Expression,
    checker: ts.TypeChecker,
  ): string | number | boolean | undefined {
    const type = checker.getTypeAtLocation(expression);
    return this.parseLiteralValueFromTsType(type, checker);
  }

  private parseLiteralValueFromTsType(
    type: ts.Type,
    checker: ts.TypeChecker,
  ): string | number | boolean | undefined {
    if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) {
      return (type as ts.StringLiteralType).value;
    }

    if ((type.flags & ts.TypeFlags.NumberLiteral) !== 0) {
      return (type as ts.NumberLiteralType).value;
    }

    if ((type.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
      return checker.typeToString(type) === "true";
    }

    return undefined;
  }

  private createPropertyMapFromTypeLiteral(
    typeLiteral: ts.TypeLiteralNode,
  ): Map<string, ts.TypeNode> {
    const propertyMap = new Map<string, ts.TypeNode>();
    for (const member of typeLiteral.members) {
      if (!ts.isPropertySignature(member) || !member.type || !member.name) {
        continue;
      }

      const memberName = this.getMemberName(member.name);
      if (!memberName) {
        continue;
      }

      propertyMap.set(memberName, member.type);
    }

    return propertyMap;
  }

  private selectPropertyTypeNode(symbol: ts.Symbol, sourceFile: ts.SourceFile): ts.TypeNode | null {
    const declarations = symbol
      .getDeclarations()
      ?.filter((declaration) => !this.isAuthoringHelperPropertyDeclaration(declaration))
      .flatMap((declaration) => {
        const typeNode = this.getPropertyTypeNode(declaration);
        return typeNode ? [{ declaration, typeNode }] : [];
      });

    if (!declarations || declarations.length === 0) {
      return null;
    }

    const inSourceFile = declarations.find(
      ({ declaration }) => declaration.getSourceFile().fileName === sourceFile.fileName,
    );

    return inSourceFile?.typeNode ?? declarations[0].typeNode;
  }

  private getPropertyTypeNode(declaration: ts.Declaration): ts.TypeNode | null {
    if (
      (ts.isPropertySignature(declaration) || ts.isPropertyDeclaration(declaration)) &&
      declaration.type
    ) {
      return declaration.type;
    }

    return null;
  }

  private isAuthoringHelperPropertyDeclaration(declaration: ts.Declaration): boolean {
    if (!ts.isPropertySignature(declaration) || !ts.isTypeLiteralNode(declaration.parent)) {
      return false;
    }

    const parent = declaration.parent.parent;
    return ts.isTypeAliasDeclaration(parent) && AUTHORING_HELPER_TYPE_NAMES.has(parent.name.text);
  }

  private parseSecurityScheme(
    node: ts.TypeNode | undefined,
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    diagnostics: ExtractionDiagnostic[],
    endpointName: string,
  ): string | null {
    if (!node) {
      return null;
    }

    const propertyMap = this.createPropertyMap(node, sourceFile, checker);
    if (!propertyMap) {
      diagnostics.push(
        this.createNodeDiagnostic(
          sourceFile,
          node,
          "INVALID_SECURITY_SPEC",
          `Endpoint "${endpointName}" must declare security as an object type with a string literal scheme.`,
        ),
      );
      return null;
    }

    const schemeNode = propertyMap.get("scheme");
    const securityScheme = this.parseStringLiteral(schemeNode, sourceFile);
    if (securityScheme) {
      return securityScheme;
    }

    diagnostics.push(
      this.createNodeDiagnostic(
        sourceFile,
        schemeNode ?? node,
        "INVALID_SECURITY_SPEC",
        `Endpoint "${endpointName}" must declare security.scheme as a string literal.`,
      ),
    );
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
    const diagnosticSourceFile = node.getSourceFile() ?? sourceFile;
    const position = diagnosticSourceFile.getLineAndCharacterOfPosition(
      node.getStart(diagnosticSourceFile),
    );

    return new ExtractionDiagnostic({
      severity: "error",
      code,
      message,
      filePath: diagnosticSourceFile.fileName,
      line: position.line + 1,
      column: position.character + 1,
    });
  }
}
