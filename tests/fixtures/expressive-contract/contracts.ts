import type {
  Contract,
  Endpoint,
  EndpointAuthoringSpec,
  EndpointErrorAuthoringSpec,
  EndpointSecurityAuthoringSpec,
} from "../../../dist/index.js";
import type {
  CreateMemberRequest,
  MemberDto,
  MemberEnvelope,
  PagedResult,
  SearchMembersQuery,
  UpdateMemberRequest,
  ValidationErrorDto,
} from "./models.js";
import { createMemberRequestExample, createMemberResponseExample } from "./models.js";

type AdminSecurity = EndpointSecurityAuthoringSpec & {
  readonly scheme: "admin";
};

type ValidationFailure = EndpointErrorAuthoringSpec & {
  readonly status: 422;
  readonly response: ValidationErrorDto;
  readonly description: "Validation failed";
};

export type CreateEndpointAuthoringPreview = EndpointAuthoringSpec & {
  readonly method: "POST";
  readonly route: "/api/teams/{teamId}/members";
  readonly input: CreateMemberRequest;
  readonly response: MemberEnvelope<MemberDto>;
  readonly requestExamples: [typeof createMemberRequestExample];
  readonly responseExamples: [{ status: 201; examples: [typeof createMemberResponseExample] }];
  readonly successStatus: 201;
  readonly errors: [ValidationFailure];
  readonly security: AdminSecurity;
};

export interface MembersContract extends Contract<"MembersContract"> {
  Search: Endpoint<{
    method: "GET";
    route: "/api/teams/{teamId}/members";
    input: SearchMembersQuery;
    response: PagedResult<MemberDto>;
    summary: "Search members";
    description: "Search members in a team";
  }>;

  Create: Endpoint<{
    method: "POST";
    route: "/api/teams/{teamId}/members";
    input: CreateMemberRequest;
    response: MemberEnvelope<MemberDto>;
    requestExamples: [typeof createMemberRequestExample];
    responseExamples: [{ status: 201; examples: [typeof createMemberResponseExample] }];
    successStatus: 201;
    errors: [{ status: 422; response: ValidationErrorDto; description: "Validation failed" }];
    security: { scheme: "admin" };
  }>;

  Update: Endpoint<{
    method: "PATCH";
    route: "/api/members/{id}";
    input: UpdateMemberRequest;
    response: MemberDto;
    errors: [{ status: 404; description: "Member not found" }];
    security: { scheme: "admin" };
  }>;

  ExportMembers: Endpoint<{
    method: "GET";
    route: "/api/teams/{teamId}/members/export";
    fileResponse: true;
    fileContentType: "text/csv";
    queryAuth: "token";
    summary: "Export members";
    description: "Download members as CSV";
    security: { scheme: "admin" };
  }>;

  Ping: Endpoint<{
    method: "GET";
    route: "/api/ping";
    response: void;
    anonymous: true;
    description: "Anonymous liveness probe";
  }>;
}
