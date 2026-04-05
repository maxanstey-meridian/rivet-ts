import type { Contract, Endpoint, EndpointAuthoringSpec } from "../../../dist/index.js";
import type { CreateMemberRequest } from "./models.js";
import {
  createMemberRequestExample,
  legacyMemberRequestExample,
  reviewMemberRequestExample,
} from "./models.js";

export type CreateEndpointAuthoringPreview = EndpointAuthoringSpec & {
  readonly method: "POST";
  readonly route: "/api/request-examples";
  readonly input: CreateMemberRequest;
  readonly response: void;
  readonly requestExamples: [
    typeof createMemberRequestExample,
    { readonly json: typeof reviewMemberRequestExample },
  ];
};

export interface RequestExamplesContract extends Contract<"RequestExamplesContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/request-examples";
    input: CreateMemberRequest;
    response: void;
    requestExamples: [
      typeof createMemberRequestExample,
      { json: typeof reviewMemberRequestExample },
    ];
  }>;

  LegacyCreate: Endpoint<{
    method: "POST";
    route: "/api/request-examples/legacy";
    input: CreateMemberRequest;
    response: void;
    requestExample: typeof legacyMemberRequestExample;
  }>;
}
