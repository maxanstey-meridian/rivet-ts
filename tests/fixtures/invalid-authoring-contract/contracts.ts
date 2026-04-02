import type { Contract, Endpoint } from "../../../dist/index.js";

export interface InvalidAuthoringContract extends Contract<"InvalidAuthoringContract"> {
  BrokenTopLevel: Endpoint<{
    method: "GET";
    route: "/api/broken";
    response: void;
    topLevelExtra: "bar";
  }>;

  BrokenSecurity: Endpoint<{
    method: "GET";
    route: "/api/broken-security";
    response: void;
    security: {
      scheme: "admin";
      securityExtra: "bar";
    };
  }>;

  BrokenError: Endpoint<{
    method: "GET";
    route: "/api/broken-error";
    response: void;
    errors: [
      {
        status: 400;
        errorExtra: "bar";
      },
    ];
  }>;
}
