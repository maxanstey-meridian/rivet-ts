import { defineHandlers, handle } from "../../../dist/index.js";
import type { SummaryContract } from "./summary-contract.js";

export const summaryHandlers = defineHandlers<SummaryContract>()({
  GetSummary: handle<SummaryContract, "GetSummary">(async () => ({
    totalPets: 42,
    totalSpecies: 5,
  })),
});
