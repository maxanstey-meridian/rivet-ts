import type { Contract, Endpoint } from "./rivet.js";
import type {
  CreateMemberRequest,
  MemberDto,
  MemberEnvelope,
  PagedResult,
  SearchMembersQuery,
  UpdateMemberRequest,
  ValidationErrorDto,
} from "./models.js";

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

  Ping: Endpoint<{
    method: "GET";
    route: "/api/ping";
    response: void;
    anonymous: true;
    description: "Anonymous liveness probe";
  }>;
}
