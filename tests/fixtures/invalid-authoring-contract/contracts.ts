import type { Contract, Endpoint } from "../../../src/index.js";

export interface InvalidAuthoringContract extends Contract<"InvalidAuthoringContract"> {
  Broken: Endpoint<{
    method: "GET";
    route: "/api/broken";
    response: void;
    foo: "bar";
  }>;
}
