import type { RivetContractDocument } from "../../domain/rivet-contract.js";

/**
 * `--security <scheme>=bearer` for each scheme the contract's endpoints use:
 * Rivet refuses a secured endpoint whose scheme the command line does not
 * define (RIV2002), and a contract names its schemes but not their kind.
 */
export const bearerSecurityArguments = (document: RivetContractDocument): readonly string[] =>
  [...new Set(document.endpoints.flatMap(({ security }) => security?.scheme ?? []))].flatMap(
    (scheme) => ["--security", `${scheme}=bearer`],
  );
