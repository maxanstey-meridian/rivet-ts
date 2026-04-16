import type { Contract, Endpoint } from "../../../dist/index.js";

export interface NodeContract extends Contract<"NodeContract"> {
  ReadFile: Endpoint<{
    method: "GET";
    route: "/api/file";
    response: string;
  }>;
}
