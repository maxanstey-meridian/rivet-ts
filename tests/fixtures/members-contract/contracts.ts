import type { Contract, Endpoint } from "./rivet.js";
import type {
  InviteMemberRequest,
  InviteMemberResponse,
  MemberDto,
  NotFoundDto,
  PagedResult,
  UpdateRoleRequest,
  ValidationErrorDto,
} from "./models.js";

export interface MembersContract extends Contract<"MembersContract"> {
  List: Endpoint<{
    method: "GET";
    route: "/api/members";
    response: PagedResult<MemberDto>;
    description: "List all team members";
  }>;

  Invite: Endpoint<{
    method: "POST";
    route: "/api/members";
    input: InviteMemberRequest;
    response: InviteMemberResponse;
    successStatus: 201;
    errors: [{ status: 422; response: ValidationErrorDto; description: "Validation failed" }];
    security: { scheme: "admin" };
  }>;

  Remove: Endpoint<{
    method: "DELETE";
    route: "/api/members/{id}";
    response: void;
    errors: [{ status: 404; response: NotFoundDto; description: "Member not found" }];
    security: { scheme: "admin" };
  }>;

  UpdateRole: Endpoint<{
    method: "PUT";
    route: "/api/members/{id}/role";
    input: UpdateRoleRequest;
    response: void;
    successStatus: 204;
    errors: [{ status: 404; response: NotFoundDto; description: "Member not found" }];
    security: { scheme: "admin" };
  }>;

  Health: Endpoint<{
    method: "GET";
    route: "/api/health";
    response: void;
    description: "Health check";
    anonymous: true;
  }>;
}
