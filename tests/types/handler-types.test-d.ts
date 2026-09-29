import type { Contract, Endpoint } from "../../src/domain/authoring-types.js";
import {
  asRivetHandler,
  type ContractEndpointKey,
  type EndpointSpecOf,
  type RivetHandler,
  type RivetHandlerOwner,
  type RivetHandlerResult,
} from "../../src/domain/handler-types.js";

interface DirectorySearchRequest {
  readonly query: string;
  readonly page: number;
}

interface DirectoryMemberDto {
  readonly id: string;
  readonly displayName: string;
}

interface DirectorySearchResponse {
  readonly items: readonly DirectoryMemberDto[];
  readonly totalCount: number;
}

interface DirectoryStatusResponse {
  readonly status: "ok";
}

interface FormSubmission {
  readonly name: string;
  readonly email: string;
}

interface DirectoryContract extends Contract<"DirectoryContract"> {
  Search: Endpoint<{
    method: "POST";
    route: "/api/directory/search";
    input: DirectorySearchRequest;
    response: DirectorySearchResponse;
  }>;

  Health: Endpoint<{
    method: "GET";
    route: "/api/directory/health";
    response: DirectoryStatusResponse;
  }>;

  Export: Endpoint<{
    method: "POST";
    route: "/api/directory/export";
    input: DirectorySearchRequest;
    response: void;
    fileResponse: true;
    fileContentType: "text/csv";
  }>;

  SubmitForm: Endpoint<{
    method: "POST";
    route: "/api/directory/form";
    input: FormSubmission;
    response: void;
    formEncoded: true;
  }>;
}

test("RivetHandler types body and enforces response shape", () => {
  const search: RivetHandler<DirectoryContract, "Search"> = async ({ body }) => {
    expectTypeOf(body).toEqualTypeOf<DirectorySearchRequest>();

    return {
      items: [{ id: "mem_123", displayName: body.query }],
      totalCount: body.page,
    };
  };

  expectTypeOf(search).returns.resolves.toEqualTypeOf<DirectorySearchResponse>();
});

test("RivetHandler supports inputless endpoints", () => {
  const health: RivetHandler<DirectoryContract, "Health"> = async () => ({
    status: "ok" as const,
  });

  expectTypeOf(health).returns.resolves.toEqualTypeOf<DirectoryStatusResponse>();
});

test("RivetHandler maps file responses to Blob", () => {
  const exported: RivetHandler<DirectoryContract, "Export"> = async ({ body }) => {
    expectTypeOf(body).toEqualTypeOf<DirectorySearchRequest>();

    return new Blob([body.query], { type: "text/csv" });
  };

  expectTypeOf(exported).returns.resolves.toEqualTypeOf<Blob>();
});

test("RivetHandler receives { body: TInput } for form-encoded endpoints", () => {
  const submit: RivetHandler<DirectoryContract, "SubmitForm"> = async ({ body }) => {
    expectTypeOf(body).toEqualTypeOf<FormSubmission>();
  };
  expectTypeOf(submit).returns.resolves.toEqualTypeOf<void>();
});

test("contract helpers expose only endpoint keys", () => {
  type EndpointKeys = ContractEndpointKey<DirectoryContract>;
  type SearchSpec = EndpointSpecOf<DirectoryContract, "Search">;
  type SearchResult = RivetHandlerResult<DirectoryContract, "Search">;

  expectTypeOf<EndpointKeys>().toEqualTypeOf<"Search" | "Health" | "Export" | "SubmitForm">();
  expectTypeOf<SearchSpec>().toEqualTypeOf<{
    method: "POST";
    route: "/api/directory/search";
    input: DirectorySearchRequest;
    response: DirectorySearchResponse;
  }>();
  expectTypeOf<SearchResult>().toEqualTypeOf<DirectorySearchResponse>();
});

test("asRivetHandler returns the endpoint's RivetHandler for a handle or invoke owner", () => {
  expectTypeOf(
    asRivetHandler<DirectoryContract, "Search">({
      handle: async ({ body }) => ({ items: [], totalCount: body.page }),
    }),
  ).toEqualTypeOf<RivetHandler<DirectoryContract, "Search">>();
  expectTypeOf(
    asRivetHandler<DirectoryContract, "Health">({ invoke: async () => ({ status: "ok" }) }),
  ).toEqualTypeOf<RivetHandler<DirectoryContract, "Health">>();
});

test("asRivetHandler keeps a wider handler input when it is declared explicitly", () => {
  type WiderInput = { body: DirectorySearchRequest; actorSubjectKey: string };
  const owner: RivetHandlerOwner<DirectoryContract, "Search", WiderInput> = {
    handle: async ({ body, actorSubjectKey }) => ({
      items: [{ id: "mem_123", displayName: `${actorSubjectKey}:${body.query}` }],
      totalCount: body.page,
    }),
  };

  expectTypeOf(asRivetHandler<DirectoryContract, "Search", WiderInput>(owner)).toEqualTypeOf<
    (input: WiderInput) => Promise<DirectorySearchResponse>
  >();
});

// For a bodyless method (not POST/PUT/PATCH) the lowerer turns `input` into
// query params and the Hono adapter delivers them under `query`; the handler
// types must say the same thing.

interface BodylessInputContract extends Contract<"BodylessInputContract"> {
  ListMembers: Endpoint<{
    method: "GET";
    route: "/api/directory/members";
    input: { readonly q?: string; readonly page: number };
    response: DirectorySearchResponse;
  }>;

  PurgeMembers: Endpoint<{
    method: "DELETE";
    route: "/api/directory/members";
    input: { readonly confirm: boolean };
    response: void;
  }>;
}

test("RivetHandler maps GET input to { query }, with no body key", () => {
  const list: RivetHandler<BodylessInputContract, "ListMembers"> = async (input) => {
    expectTypeOf(input).toEqualTypeOf<{
      readonly query: { readonly q?: string; readonly page: number };
    }>();
    expectTypeOf(input).not.toHaveProperty("body");
    expectTypeOf(input.query).toEqualTypeOf<{ readonly q?: string; readonly page: number }>();

    return {
      items: [],
      totalCount: input.query.page,
    };
  };

  expectTypeOf(list).returns.resolves.toEqualTypeOf<DirectorySearchResponse>();
});

test("RivetHandler maps DELETE input to { query }, with no body key", () => {
  type PurgeInput = Parameters<RivetHandler<BodylessInputContract, "PurgeMembers">>[0];

  expectTypeOf<PurgeInput>().toEqualTypeOf<{ readonly query: { readonly confirm: boolean } }>();
  expectTypeOf<PurgeInput>().not.toHaveProperty("body");
});

test("RivetHandler keeps body-method input mapped to { body }", () => {
  type SearchInput = Parameters<RivetHandler<DirectoryContract, "Search">>[0];

  expectTypeOf<SearchInput>().toEqualTypeOf<{ readonly body: DirectorySearchRequest }>();
  expectTypeOf<SearchInput>().not.toHaveProperty("query");
});
