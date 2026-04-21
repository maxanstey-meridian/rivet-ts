import type { RivetHandler } from "../../../dist/index.js";
import type { SummaryContract } from "./summary-contract.js";

const getSummary: RivetHandler<SummaryContract, "GetSummary"> = async () => ({
  totalPets: 42,
  totalSpecies: 5,
});

export const summaryHandlers = {
  GetSummary: getSummary,
};
