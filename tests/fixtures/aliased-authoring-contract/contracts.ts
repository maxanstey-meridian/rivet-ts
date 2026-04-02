import type { Contract, Endpoint, EndpointAuthoringSpec } from "../../../dist/index.js";

export interface MemberDto {
  id: string;
  email: string;
}

export type ListMembersSpec = EndpointAuthoringSpec & {
  method: "GET";
  route: "/api/aliased-members";
  response: MemberDto[];
  summary: "List aliased members";
  description: "List members from an aliased endpoint spec";
  security: { scheme: "admin" };
  errors: [{ status: 404; description: "Members not found" }];
};

export interface AliasedMembersContract extends Contract<"AliasedMembersContract"> {
  List: Endpoint<ListMembersSpec>;
}
