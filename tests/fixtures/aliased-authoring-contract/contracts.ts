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

export interface ListMembersQuery {
  search?: string;
}

export const listMembersRequestExample = {
  search: "Ada",
} satisfies ListMembersQuery;

export const listMembersResponseExample = [
  {
    id: "mem_123",
    email: "ada@example.com",
  },
] satisfies MemberDto[];

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
  input: ListMembersQuery;
  response: MemberDto[];
  requestExample: typeof listMembersRequestExample;
  successResponseExample: typeof listMembersResponseExample;
  summary: "List aliased members";
  description: "List members from an aliased endpoint spec";
  security: AdminSecurity;
  errors: [NotFoundError];
};

export interface AliasedMembersContract extends Contract<"AliasedMembersContract"> {
  List: Endpoint<ListMembersSpec>;
}
