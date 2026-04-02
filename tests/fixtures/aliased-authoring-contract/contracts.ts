import type {
  Contract,
  Endpoint,
  EndpointAuthoringSpec,
  EndpointErrorAuthoringSpec,
  EndpointSecurityAuthoringSpec,
} from "../../../dist/index.js";

export interface MemberDto {
  id: string;
  email: string;
}

type AdminSecurity = EndpointSecurityAuthoringSpec & {
  scheme: "admin";
};

type NotFoundError = EndpointErrorAuthoringSpec & {
  status: 404;
  description: "Members not found";
};

export type ListMembersSpec = EndpointAuthoringSpec & {
  method: "GET";
  route: "/api/aliased-members";
  response: MemberDto[];
  summary: "List aliased members";
  description: "List members from an aliased endpoint spec";
  security: AdminSecurity;
  errors: [NotFoundError];
};

export interface AliasedMembersContract extends Contract<"AliasedMembersContract"> {
  List: Endpoint<ListMembersSpec>;
}
