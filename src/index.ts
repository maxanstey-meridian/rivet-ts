export type {
  Brand,
  Contract,
  Endpoint,
  EndpointAuthoringHttpMethod,
  EndpointExampleAuthoringReference,
  EndpointExampleAuthoringScalar,
  EndpointExampleAuthoringValue,
  EndpointAuthoringSpec,
  EndpointErrorAuthoringSpec,
  EndpointRequestExampleAuthoringDescriptor,
  EndpointRequestExampleAuthoringSpec,
  EndpointResponseExamplesAuthoringSpec,
  EndpointSecurityAuthoringSpec,
  Format,
  InlineEndpointRequestExampleAuthoringSpec,
  RefEndpointRequestExampleAuthoringSpec,
} from "./domain/authoring-types.js";
export {
  asRivetHandler,
  type ContractEndpointKey,
  type EndpointSpecOf,
  type RivetHandler,
  type RivetHandlerInput,
  type RivetHandlerResult,
  type RivetHandlerOwner,
} from "./domain/handler-types.js";
export type { RivetInvokable } from "./hono.js";
export {
  RivetError,
  type RivetEndpointResult,
  type RivetHandlerMap,
  type RivetResult,
  type RivetSuccessResult,
} from "./domain/runtime-types.js";
export {
  EndpointExampleSpec,
  ResponseExamplesSpec,
  type EndpointExampleValue,
  type HttpMethod,
} from "./domain/contract.js";
export { ExtractionDiagnostic, type DiagnosticSeverity } from "./domain/diagnostic.js";
export {
  RivetContractDocument,
  type RivetContractEnum,
  RivetEndpointDefinition,
  RivetEndpointExample,
  type RivetEndpointExampleValue,
  RivetEndpointParam,
  RivetEndpointSecurity,
  RivetRequestExample,
  RivetResponseExample,
  RivetResponseType,
  type RivetType,
  RivetTypeDefinition,
  type RivetPropertyDefinition,
} from "./domain/rivet-contract.js";
export {
  RivetContractLoweringResult,
  type DiscoveredContract,
  type DiscoveredEndpoint,
} from "./domain/rivet-contract-lowering-result.js";
export { RivetContractLowerer } from "./application/ports/rivet-contract-lowerer.js";
export { LowerTsContractsToRivetContract } from "./application/use-cases/lower-ts-contracts-to-rivet-contract.js";
/**
 * @deprecated The frontend/lowerer split was collapsed into a single pass
 * (X13); lowering now starts from the entry path. Use
 * {@link LowerTsContractsToRivetContract} — `execute({ entryPath })`.
 */
export { LowerTsContractsToRivetContract as LowerContractBundleToRivetContract } from "./application/use-cases/lower-ts-contracts-to-rivet-contract.js";
export { TypeScriptRivetContractLowerer } from "./infrastructure/typescript/typescript-rivet-contract-lowerer.js";
export { runCli } from "./cli.js";
export { rivetTs, type RivetTsVitePluginOptions } from "./vite.js";
