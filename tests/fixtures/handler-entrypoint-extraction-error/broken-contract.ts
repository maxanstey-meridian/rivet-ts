import type { Contract, Endpoint } from "../../../dist/index.js";
import type { NonExistentType } from "./does-not-exist.js";

export interface BrokenContract extends Contract<"BrokenContract"> {
  GetBroken: Endpoint<{
    method: "GET";
    route: "/api/broken";
    response: NonExistentType;
  }>;
}
