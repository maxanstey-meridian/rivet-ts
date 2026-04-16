import type { Contract, Endpoint } from "../../../dist/index.js";
import type { SummaryDto } from "./models.js";

export interface SummaryContract extends Contract<"SummaryContract"> {
  GetSummary: Endpoint<{
    method: "GET";
    route: "/api/summary";
    response: SummaryDto;
  }>;
}
