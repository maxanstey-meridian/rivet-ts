import { expectTypeOf, test } from "vitest";
import type { Contract, Endpoint } from "../../src/domain/authoring-types.js";
import {
  handle,
  type ContractEndpointKey,
  type EndpointSpecOf,
  type RivetHandler,
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

test("handle types body and enforces response shape", async () => {
  const search = handle<DirectoryContract, "Search">(async ({ body }) => {
    expectTypeOf(body).toEqualTypeOf<DirectorySearchRequest>();

    return {
      items: [{ id: "mem_123", displayName: body.query }],
      totalCount: body.page,
    };
  });

  expectTypeOf(search).toEqualTypeOf<RivetHandler<DirectoryContract, "Search">>();

  const result = await search({
    body: {
      query: "Ada",
      page: 2,
    },
  });

  expectTypeOf(result).toEqualTypeOf<DirectorySearchResponse>();
});

test("handle supports inputless endpoints", async () => {
  const health = handle<DirectoryContract, "Health">(async () => ({
    status: "ok" as const,
  }));

  expectTypeOf(health).toEqualTypeOf<RivetHandler<DirectoryContract, "Health">>();

  const result = await health();
  expectTypeOf(result).toEqualTypeOf<DirectoryStatusResponse>();
});

test("handle maps file responses to Blob", async () => {
  const exported = handle<DirectoryContract, "Export">(async ({ body }) => {
    expectTypeOf(body).toEqualTypeOf<DirectorySearchRequest>();

    return new Blob([body.query], { type: "text/csv" });
  });

  expectTypeOf(exported).toEqualTypeOf<RivetHandler<DirectoryContract, "Export">>();

  const blob = await exported({
    body: {
      query: "Ada",
      page: 2,
    },
  });

  expectTypeOf(blob).toEqualTypeOf<Blob>();
});

test("handle receives { body: TInput } for form-encoded endpoints", async () => {
  const submit = handle<DirectoryContract, "SubmitForm">(async ({ body }) => {
    expectTypeOf(body).toEqualTypeOf<FormSubmission>();
    void body;
  });

  expectTypeOf(submit).toEqualTypeOf<RivetHandler<DirectoryContract, "SubmitForm">>();

  await submit({
    body: {
      name: "Jane",
      email: "jane@example.com",
    },
  });
});

test("contract helpers expose only endpoint keys", () => {
  type EndpointKeys = ContractEndpointKey<DirectoryContract>;
  type SearchSpec = EndpointSpecOf<DirectoryContract, "Search">;

  expectTypeOf<EndpointKeys>().toEqualTypeOf<"Search" | "Health" | "Export" | "SubmitForm">();
  expectTypeOf<SearchSpec>().toEqualTypeOf<{
    method: "POST";
    route: "/api/directory/search";
    input: DirectorySearchRequest;
    response: DirectorySearchResponse;
  }>();
});

test("compile-time rejections stay enforced", () => {
  void 0;

  // @ts-expect-error response must match the contract response type
  handle<DirectoryContract, "Search">(async ({ body }) => ({
    items: [{ id: body.query, displayName: body.query }],
  }));

  // @ts-expect-error inputless handlers should not require a body parameter
  handle<DirectoryContract, "Health">(async ({ body }) => ({
    status: body,
  }));

  // @ts-expect-error file responses must return Blob on the success path
  handle<DirectoryContract, "Export">(async () => undefined);

  // @ts-expect-error only contract endpoint keys are allowed
  handle<DirectoryContract, "__contractName">(
    async () =>
      ({
        status: "ok",
      }) as DirectoryStatusResponse,
  );
});
