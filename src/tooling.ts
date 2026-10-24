// The reflection pipeline, for build tools that lower contracts themselves.
// It loads the TypeScript compiler, so it lives off the root entry, which
// contracts, handlers and mocks import at runtime.
export { ExtractionDiagnostic, type DiagnosticSeverity } from "./domain/diagnostic.js";
export {
  RivetContractDocument,
  type RivetContractEnum,
  RivetEndpointDefinition,
  type RivetEndpointExampleValue,
  RivetEndpointParam,
  RivetEndpointSecurity,
  RivetExample,
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
export { lowerContracts } from "./infrastructure/typescript/typescript-rivet-contract-lowerer.js";
export { runCli } from "./cli.js";
