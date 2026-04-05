import type { Contract, Endpoint } from "../../../dist/index.js";
import type { CreateMemberRequest, MemberDto, ValidationErrorDto } from "./models.js";
import {
  createRequestExample,
  createSuccessResponseExample,
  createSuccessResponseExample2,
  legacyResponseExample,
  validationErrorExample,
} from "./models.js";

export interface ResponseExamplesContract extends Contract<"ResponseExamplesContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/members";
    input: CreateMemberRequest;
    response: MemberDto;
    requestExamples: [typeof createRequestExample];
    responseExamples: [
      {
        status: 201;
        examples: [typeof createSuccessResponseExample, typeof createSuccessResponseExample2];
      },
      {
        status: 422;
        examples: [typeof validationErrorExample];
      },
    ];
    successStatus: 201;
    errors: [{ status: 422; response: ValidationErrorDto; description: "Validation failed" }];
  }>;

  LegacyCreate: Endpoint<{
    method: "POST";
    route: "/api/members/legacy";
    input: CreateMemberRequest;
    response: MemberDto;
    successResponseExample: typeof legacyResponseExample;
    successStatus: 201;
  }>;
}
