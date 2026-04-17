import type { Contract, Endpoint } from "rivet-ts";

export interface MemberDto {
  id: string;
  email: string;
  role: MemberRole;
}

export type MemberRole = "admin" | "member";

export interface CreateMemberRequest {
  email: string;
}

export interface ValidationErrorDto {
  message: string;
  fields: Record<string, string[]>;
}

export interface MembersContract extends Contract<"MembersContract"> {
  List: Endpoint<{
    method: "GET";
    route: "/api/members";
    response: MemberDto[];
    description: "List all members";
  }>;

  Create: Endpoint<{
    method: "POST";
    route: "/api/members";
    input: CreateMemberRequest;
    response: MemberDto;
    successStatus: 201;
    errors: [{ status: 422; response: ValidationErrorDto; description: "Validation failed" }];
  }>;
}
