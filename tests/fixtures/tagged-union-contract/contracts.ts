import type { Contract, Endpoint } from "../../../dist/index.js";
import type { DisplayStateContract, RefreshDisplayRequest } from "./models.js";

export interface DisplayContract extends Contract<"DisplayContract"> {
  Refresh: Endpoint<{
    method: "POST";
    route: "/api/display/refresh";
    input: RefreshDisplayRequest;
    response: DisplayStateContract;
  }>;
}
