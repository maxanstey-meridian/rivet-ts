import { expect, expectTypeOf, test } from "vitest";
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

test("asRivetHandler binds a class handle method", async () => {
  class SearchHandler implements RivetHandlerOwner<DirectoryContract, "Search"> {
    public constructor(private readonly prefix: string) {}

    public async handle({
      body,
    }: {
      body: DirectorySearchRequest;
    }): Promise<DirectorySearchResponse> {
      return {
        items: [{ id: "mem_123", displayName: `${this.prefix}:${body.query}` }],
        totalCount: body.page,
      };
    }
  }

  const handler = asRivetHandler<DirectoryContract, "Search">(new SearchHandler("directory"));

  expectTypeOf(handler).toEqualTypeOf<RivetHandler<DirectoryContract, "Search">>();

  const result = await handler({
    body: {
      query: "Ada",
      page: 2,
    },
  });

  expect(result).toEqual({
    items: [{ id: "mem_123", displayName: "directory:Ada" }],
    totalCount: 2,
  });
});

test("asRivetHandler preserves wider handler input when explicitly declared", async () => {
  class SearchWithActorHandler implements RivetHandlerOwner<
    DirectoryContract,
    "Search",
    { body: DirectorySearchRequest; actorSubjectKey: string }
  > {
    public async handle({
      body,
      actorSubjectKey,
    }: {
      body: DirectorySearchRequest;
      actorSubjectKey: string;
    }): Promise<DirectorySearchResponse> {
      return {
        items: [{ id: "mem_123", displayName: `${actorSubjectKey}:${body.query}` }],
        totalCount: body.page,
      };
    }
  }

  const handler = asRivetHandler<
    DirectoryContract,
    "Search",
    { body: DirectorySearchRequest; actorSubjectKey: string }
  >(new SearchWithActorHandler());

  expectTypeOf(handler).toEqualTypeOf<
    (input: {
      body: DirectorySearchRequest;
      actorSubjectKey: string;
    }) => Promise<DirectorySearchResponse>
  >();

  const result = await handler({
    body: {
      query: "Ada",
      page: 2,
    },
    actorSubjectKey: "admin",
  });

  expect(result).toEqual({
    items: [{ id: "mem_123", displayName: "admin:Ada" }],
    totalCount: 2,
  });
});

test("asRivetHandler binds an invoke method when handle is absent", async () => {
  class HealthHandler implements RivetHandlerOwner<DirectoryContract, "Health"> {
    public constructor(private readonly status: DirectoryStatusResponse["status"]) {}

    public async invoke(): Promise<DirectoryStatusResponse> {
      return { status: this.status };
    }
  }

  const handler = asRivetHandler<DirectoryContract, "Health">(new HealthHandler("ok"));

  expectTypeOf(handler).toEqualTypeOf<RivetHandler<DirectoryContract, "Health">>();
  await expect(handler()).resolves.toEqual({ status: "ok" });
});

test("asRivetHandler rejects ambiguous handler owners", () => {
  class AmbiguousHandler implements RivetHandlerOwner<DirectoryContract, "Health"> {
    public async handle(): Promise<DirectoryStatusResponse> {
      return { status: "ok" };
    }

    public async invoke(): Promise<DirectoryStatusResponse> {
      return { status: "ok" };
    }
  }

  expect(() => asRivetHandler<DirectoryContract, "Health">(new AmbiguousHandler())).toThrow(
    'asRivetHandler expected exactly one handler method. Found both "handle" and "invoke".',
  );
});

test("asRivetHandler rejects owners without a recognized method", () => {
  expect(() => asRivetHandler({} as never)).toThrow(
    'asRivetHandler expected a "handle" or "invoke" method.',
  );
});
