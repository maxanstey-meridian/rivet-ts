import type { Contract, Endpoint } from "../../src/domain/authoring-types.js";
import { asRivetHandler, type RivetHandlerOwner } from "../../src/domain/handler-types.js";
import { RivetError } from "../../src/domain/runtime-types.js";

interface DirectorySearchRequest {
  readonly query: string;
  readonly page: number;
}

interface DirectorySearchResponse {
  readonly items: readonly { readonly id: string; readonly displayName: string }[];
  readonly totalCount: number;
}

interface DirectoryStatusResponse {
  readonly status: "ok";
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
}

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

test("RivetError extends Error and stores result", () => {
  const error = new RivetError({ status: 400, data: { message: "bad" } });

  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(RivetError);
  expect(error.message).toBe("RivetError");
  expect(error.result.status).toBe(400);
  expect(error.result.data).toEqual({ message: "bad" });
});
