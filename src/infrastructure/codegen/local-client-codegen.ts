import { GeneratedClientModule } from "../../domain/generated-client-module.js";
import { HandlerGroup } from "../../domain/handler-group.js";
import type {
  RivetContractDocument,
  RivetEndpointDefinition,
  RivetType,
} from "../../domain/rivet-contract.js";
import { LocalClientCodegen as AbstractLocalClientCodegen } from "../../application/ports/local-client-codegen.js";
import {
  emitTypeExpression,
  emitTypeDefinition,
  emitEnumDeclaration,
} from "./rivet-type-to-typescript.js";

export const deriveClientName = (exportName: string): string => {
  if (exportName.endsWith("Handlers")) {
    return exportName.slice(0, -"Handlers".length);
  }
  if (exportName.endsWith("handlers")) {
    return exportName.slice(0, -"handlers".length);
  }
  return exportName;
};

const generateJs = (handlerGroup: HandlerGroup, clientName: string): string => {
  const lines = [
    `import { createDirectClient } from '../runtime/rivet-runtime.js';`,
    `import { ${handlerGroup.exportName} } from '../runtime/handlers.js';`,
    `export const ${clientName} = createDirectClient(${handlerGroup.exportName});`,
    ``,
  ];
  return lines.join("\n");
};

const toCamelCase = (name: string): string =>
  name.charAt(0).toLowerCase() + name.slice(1);

const findEndpointDef = (
  endpointName: string,
  endpoints: readonly RivetEndpointDefinition[],
): RivetEndpointDefinition | undefined => {
  const camel = toCamelCase(endpointName);
  return endpoints.find((e) => e.name === camel);
};

const getInputType = (endpoint: RivetEndpointDefinition): RivetType | undefined => {
  const bodyParam = endpoint.params.find((p) => p.source === "body");
  return bodyParam?.type;
};

const getSuccessResponseType = (endpoint: RivetEndpointDefinition): string => {
  if (endpoint.fileContentType) {
    return "Blob";
  }
  if (endpoint.returnType) {
    return emitTypeExpression(endpoint.returnType);
  }
  return "void";
};

const getSuccessStatus = (endpoint: RivetEndpointDefinition): number => {
  const successResponse = endpoint.responses.find((r) => r.statusCode >= 200 && r.statusCode < 300);
  return successResponse?.statusCode ?? 200;
};

const getErrorVariants = (
  endpoint: RivetEndpointDefinition,
): Array<{ status: number; dataType: string }> => {
  const successStatus = getSuccessStatus(endpoint);
  return endpoint.responses
    .filter((r) => r.statusCode !== successStatus && r.dataType)
    .map((r) => ({
      status: r.statusCode,
      dataType: emitTypeExpression(r.dataType!),
    }));
};

const emitEndpointMethod = (
  endpointName: string,
  endpoint: RivetEndpointDefinition,
): string => {
  const inputType = getInputType(endpoint);
  const successType = getSuccessResponseType(endpoint);
  const successStatus = getSuccessStatus(endpoint);
  const errorVariants = getErrorVariants(endpoint);

  const successResult = `{ readonly status: ${successStatus}; readonly data: ${successType} }`;
  const errorResults = errorVariants.map(
    (v) => `{ readonly status: ${v.status}; readonly data: ${v.dataType} }`,
  );
  const endpointResult =
    errorResults.length > 0
      ? [successResult, ...errorResults].join(" | ")
      : successResult;

  if (inputType) {
    const inputExpr = emitTypeExpression(inputType);
    return [
      `    ${endpointName}(input: ${inputExpr}): Promise<${successType}>;`,
      `    ${endpointName}(input: ${inputExpr}, options: { readonly unwrap: false }): Promise<${endpointResult}>;`,
    ].join("\n");
  }

  return [
    `    ${endpointName}(): Promise<${successType}>;`,
    `    ${endpointName}(options: { readonly unwrap: false }): Promise<${endpointResult}>;`,
  ].join("\n");
};

const generateDts = (
  handlerGroup: HandlerGroup,
  contractDocument: RivetContractDocument,
  clientName: string,
): string => {
  const lines: string[] = [];

  // Emit enums
  for (const rivetEnum of contractDocument.enums) {
    lines.push(emitEnumDeclaration(rivetEnum));
    lines.push("");
  }

  // Emit types
  for (const typeDef of contractDocument.types) {
    lines.push(emitTypeDefinition(typeDef));
    lines.push("");
  }

  // Build the client interface with concrete method signatures
  const methodLines: string[] = [];
  for (const endpointName of handlerGroup.endpointNames) {
    const endpointDef = findEndpointDef(endpointName, contractDocument.endpoints);
    if (endpointDef) {
      methodLines.push(emitEndpointMethod(endpointName, endpointDef));
    }
  }

  lines.push(`export interface ${handlerGroup.contractName}Client {`);
  lines.push(methodLines.join("\n"));
  lines.push(`}`);
  lines.push("");

  // Export the client const
  lines.push(`export declare const ${clientName}: ${handlerGroup.contractName}Client;`);
  lines.push("");

  return lines.join("\n");
};

export class LocalClientCodegen extends AbstractLocalClientCodegen {
  public generate(
    handlerGroup: HandlerGroup,
    contractDocument: RivetContractDocument,
  ): GeneratedClientModule {
    const clientName = deriveClientName(handlerGroup.exportName);

    return new GeneratedClientModule({
      handlerGroupExportName: handlerGroup.exportName,
      clientName,
      jsSource: generateJs(handlerGroup, clientName),
      dtsSource: generateDts(handlerGroup, contractDocument, clientName),
    });
  }
}
