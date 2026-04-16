import { expectTypeOf, test } from "vitest";
import type { Contract, Endpoint } from "../../src/domain/authoring-types.js";
import {
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

test("RivetHandler types body and enforces response shape", async () => {
  const search: RivetHandler<DirectoryContract, "Search"> = async ({ body }) => {
    expectTypeOf(body).toEqualTypeOf<DirectorySearchRequest>();

    return {
      items: [{ id: "mem_123", displayName: body.query }],
      totalCount: body.page,
    };
  };

  const result = await search({
    body: {
      query: "Ada",
      page: 2,
    },
  });

  expectTypeOf(result).toEqualTypeOf<DirectorySearchResponse>();
});

test("RivetHandler supports inputless endpoints", async () => {
  const health: RivetHandler<DirectoryContract, "Health"> = async () => ({
    status: "ok" as const,
  });

  const result = await health();
  expectTypeOf(result).toEqualTypeOf<DirectoryStatusResponse>();
});

test("RivetHandler maps file responses to Blob", async () => {
  const exported: RivetHandler<DirectoryContract, "Export"> = async ({ body }) => {
    expectTypeOf(body).toEqualTypeOf<DirectorySearchRequest>();

    return new Blob([body.query], { type: "text/csv" });
  };

  const blob = await exported({
    body: {
      query: "Ada",
      page: 2,
    },
  });

  expectTypeOf(blob).toEqualTypeOf<Blob>();
});

test("RivetHandler receives { body: TInput } for form-encoded endpoints", async () => {
  const submit: RivetHandler<DirectoryContract, "SubmitForm"> = async ({ body }) => {
    expectTypeOf(body).toEqualTypeOf<FormSubmission>();
    void body;
  };

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
