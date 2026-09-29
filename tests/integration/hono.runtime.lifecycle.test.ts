import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { registerRivetHonoRoutes, rivetHttpError, type RivetInvokable } from "../../src/hono.js";
import type { Contract, Endpoint, RivetHandler, RivetHandlerInput } from "../../src/index.js";
import type {
  CatalogContract,
  ConflictDto,
  DirectoryContract,
  DirectorySearchRequest,
  DirectorySearchResponse,
  DirectoryStatusResponse,
  PetContract,
} from "../fixtures/hono-runtime/directory.js";
import type { OwnersContract, PetsContract } from "../fixtures/hono-runtime/pets-and-owners.js";
import { type ContractJson, lowerFixture } from "../support/lower.js";

// The runtime is driven by the contract JSON the real lowerer produces from
// the TS contracts the handlers are typed against.
const lowerHonoFixture = (file: string): ContractJson => {
  const { lowered, document } = lowerFixture("hono-runtime", file);
  expect(lowered.diagnostics).toEqual([]);
  return document;
};

let directory: ContractJson;
let petsAndOwners: ContractJson;
let sharedEndpointNames: ContractJson;
let sharedRoutes: ContractJson;

beforeAll(() => {
  directory = lowerHonoFixture("directory.ts");
  petsAndOwners = lowerHonoFixture("pets-and-owners.ts");
  sharedEndpointNames = lowerHonoFixture("shared-endpoint-names.ts");
  sharedRoutes = lowerHonoFixture("shared-routes.ts");
});

const searchEchoHandler: RivetHandler<DirectoryContract, "Search"> = async ({ body }) => ({
  query: body.query,
});

const healthHandler: RivetHandler<DirectoryContract, "Health"> = async () => ({ status: "ok" });

const directoryHandlers = {
  Search: searchEchoHandler,
  Health: healthHandler,
  Export: (async () => new Blob(["id,name\n1,Ada\n"], { type: "text/csv" })) satisfies RivetHandler<
    DirectoryContract,
    "Export"
  >,
  SubmitForm: (async ({ body }) => ({
    query: `${body.name}:${body.email}`,
  })) satisfies RivetHandler<DirectoryContract, "SubmitForm">,
  UploadDocument: (async () => undefined) satisfies RivetHandler<
    DirectoryContract,
    "UploadDocument"
  >,
};

const postJson = (app: Hono, route: string, body: string) =>
  app.request(route, { method: "POST", headers: { "content-type": "application/json" }, body });

const search = (app: Hono) =>
  postJson(app, "/api/directory/search", JSON.stringify({ query: "Ada" }));

describe("handler resolution", () => {
  it("uses plain function handlers directly", async () => {
    const app = new Hono();
    registerRivetHonoRoutes<DirectoryContract>(app, directory, {
      group: "directory",
      handlers: directoryHandlers,
    });

    const response = await search(app);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ query: "Ada" });
  });

  it("instantiates zero-arg class handlers once per request", async () => {
    let constructorCalls = 0;
    class HealthHandler implements RivetInvokable<DirectoryContract, "Health"> {
      public constructor() {
        constructorCalls += 1;
      }

      public async handle(): Promise<DirectoryStatusResponse> {
        return { status: "ok" };
      }
    }
    const app = new Hono();
    registerRivetHonoRoutes<DirectoryContract>(app, directory, {
      group: "directory",
      handlers: { ...directoryHandlers, Health: HealthHandler },
    });

    for (const _ of [1, 2]) {
      const response = await app.request("/api/directory/health");
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: "ok" });
    }
    expect(constructorCalls).toBe(2);
  });

  class PrefixedSearchHandler implements RivetInvokable<DirectoryContract, "Search"> {
    public constructor(private readonly prefix: string) {}

    public async handle({
      body,
    }: {
      body: DirectorySearchRequest;
    }): Promise<DirectorySearchResponse> {
      return { query: `${this.prefix}:${body.query}` };
    }
  }

  it("resolves class handlers through resolveHandler", async () => {
    const app = new Hono();
    registerRivetHonoRoutes<DirectoryContract>(app, directory, {
      group: "directory",
      handlers: { ...directoryHandlers, Search: PrefixedSearchHandler },
      resolveHandler: (Handler) => new Handler("directory"),
    });

    const response = await search(app);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ query: "directory:Ada" });
  });

  it("throws when a class handler needs constructor dependencies but no resolver is supplied", () => {
    expect(() =>
      registerRivetHonoRoutes<DirectoryContract>(new Hono(), directory, {
        group: "directory",
        handlers: { ...directoryHandlers, Search: PrefixedSearchHandler },
      }),
    ).toThrow(
      'Handler class "PrefixedSearchHandler" for endpoint "search" requires constructor dependencies. Supply "resolveHandler" at registration.',
    );
  });

  it("runs the Hono middleware of a rich endpoint entry before its handler", async () => {
    const app = new Hono();
    registerRivetHonoRoutes<DirectoryContract>(app, directory, {
      group: "directory",
      handlers: {
        ...directoryHandlers,
        Search: {
          handler: searchEchoHandler,
          middleware: [
            async (context, next) => {
              if (context.req.header("x-allow-search") !== "yes") {
                return context.json({ code: "forbidden" }, 403);
              }
              await next();
            },
          ],
        },
      },
    });

    const blocked = await search(app);
    expect(blocked.status).toBe(403);
    await expect(blocked.json()).resolves.toEqual({ code: "forbidden" });

    const allowed = await app.request("/api/directory/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-allow-search": "yes" },
      body: JSON.stringify({ query: "Ada" }),
    });
    expect(allowed.status).toBe(201);
    await expect(allowed.json()).resolves.toEqual({ query: "Ada" });
  });

  it("fails fast when a selected endpoint has no handler", () => {
    expect(() =>
      registerRivetHonoRoutes<DirectoryContract>(new Hono(), directory, {
        group: "directory",
        handlers: { Search: searchEchoHandler },
      }),
    ).toThrow('No handler was provided for endpoint "health".');
  });

  it("fails fast on unused handlers", () => {
    expect(() =>
      registerRivetHonoRoutes<DirectoryContract>(new Hono(), directory, {
        group: "directory",
        handlers: {
          ...directoryHandlers,
          Unknown: async () => ({ status: "ok" as const }),
        } as never,
      }),
    ).toThrow("Unused handlers were provided: Unknown.");
  });
});

describe("groups", () => {
  it("mounts only the selected group and answers a void success with an empty body", async () => {
    const pingHandler: RivetHandler<PetContract, "Ping"> = async () => undefined;
    const app = new Hono();
    registerRivetHonoRoutes<PetContract>(app, directory, {
      group: "pet",
      handlers: { Ping: pingHandler },
    });

    const ping = await app.request("/api/ping", { method: "POST" });
    expect(ping.status).toBe(204);
    await expect(ping.text()).resolves.toBe("");
    expect((await app.request("/api/health")).status).toBe(404);
  });

  it("mounts every contract's endpoints at their own routes when group is omitted", async () => {
    const app = new Hono();
    registerRivetHonoRoutes<PetsContract & OwnersContract>(app, petsAndOwners, {
      handlers: {
        ListPets: async () => ({ kind: "pets" as const }),
        ListOwners: async () => ({ kind: "owners" as const }),
      },
    });

    await expect((await app.request("/api/pets")).json()).resolves.toEqual({ kind: "pets" });
    await expect((await app.request("/api/owners")).json()).resolves.toEqual({ kind: "owners" });
  });

  it("fails loudly without a group when one handler key matches endpoints in several groups", () => {
    expect(() =>
      registerRivetHonoRoutes(new Hono(), sharedEndpointNames, {
        handlers: { Get: async () => "x" } as never,
      }),
    ).toThrow(/matched multiple endpoints/);
  });

  it("fails loudly at registration when two contracts share a route and method", () => {
    expect(() =>
      registerRivetHonoRoutes(new Hono(), sharedRoutes, {
        handlers: { ListPets: async () => "x", ListOwners: async () => "x" } as never,
      }),
    ).toThrow(/Duplicate route/);
  });
});

describe("request binding", () => {
  it("parses form-encoded bodies into handler input", async () => {
    const app = new Hono();
    registerRivetHonoRoutes<DirectoryContract>(app, directory, {
      group: "directory",
      handlers: directoryHandlers,
    });

    const response = await app.request("/api/directory/forms", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "Jane", email: "jane@example.com" }).toString(),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ query: "Jane:jane@example.com" });
  });

  it("parses a multipart request into file and form-field body plus route params", async () => {
    let received: RivetHandlerInput<DirectoryContract, "UploadDocument"> | undefined;
    const app = new Hono();
    registerRivetHonoRoutes<DirectoryContract>(app, directory, {
      group: "directory",
      handlers: {
        ...directoryHandlers,
        UploadDocument: async (input) => {
          received = input;
        },
      },
    });
    const form = new FormData();
    form.set("file", new File(["hello"], "report.txt", { type: "text/plain" }));
    form.set("title", "Quarterly report");
    form.set("description", "Draft");

    const response = await app.request("/api/directory/documents/doc_123", {
      method: "PUT",
      body: form,
    });

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
    // The route placeholder arrives under `params`, although the handler type
    // (derived from `input`) declares it on `body` (recorded follow-up).
    expect(received).toEqual({
      body: { file: expect.any(File), title: "Quarterly report", description: "Draft" },
      params: { documentId: "doc_123" },
    });
    await expect(received?.body.file.text()).resolves.toBe("hello");
  });

  it("answers 400 for a missing declared multipart file field without invoking the handler", async () => {
    let handlerCalls = 0;
    const app = new Hono();
    registerRivetHonoRoutes<DirectoryContract>(app, directory, {
      group: "directory",
      handlers: {
        ...directoryHandlers,
        UploadDocument: async () => {
          handlerCalls += 1;
        },
      },
    });
    const form = new FormData();
    form.set("title", "Quarterly report");
    form.set("description", "Draft");

    const response = await app.request("/api/directory/documents/doc_123", {
      method: "PUT",
      body: form,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "MISSING_MULTIPART_FIELD",
      message: expect.stringContaining("file") as string,
    });
    expect(handlerCalls).toBe(0);
  });

  it("answers 400 for a malformed JSON body without invoking the handler", async () => {
    let handlerCalls = 0;
    const app = new Hono();
    registerRivetHonoRoutes<DirectoryContract>(app, directory, {
      group: "directory",
      handlers: {
        ...directoryHandlers,
        Search: async ({ body }) => {
          handlerCalls += 1;
          return { query: body.query };
        },
      },
    });

    const response = await postJson(app, "/api/directory/search", "{not json");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_REQUEST_BODY",
      message: expect.stringContaining("search") as string,
    });
    expect(handlerCalls).toBe(0);
  });

  // For a bodyless method the handler receives `input` as `query`, so values
  // must arrive coerced to their contract types, not as raw strings.
  const catalogApp = (): Hono => {
    const app = new Hono();
    registerRivetHonoRoutes<CatalogContract>(app, directory, {
      group: "catalog",
      handlers: {
        GetItem: async ({ params }) => ({ id: params.id }),
        ListItems: async ({ query }) => ({ ...query }),
      },
    });
    return app;
  };

  it.each([
    [
      "typed query values",
      "/api/catalog?page=2&includeArchived=true&tags=a&tags=b",
      { page: 2, includeArchived: true, tags: ["a", "b"] },
    ],
    [
      "a single value for an array query param as an array",
      "/api/catalog?page=1&tags=solo",
      { page: 1, tags: ["solo"] },
    ],
    ["a route param as its declared number type", "/api/catalog/42", { id: 42 }],
  ])("delivers %s", async (_, route, expected) => {
    const response = await catalogApp().request(route);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expected);
  });

  it.each([
    [
      "a repeated non-array query param",
      "/api/catalog?page=1&page=2",
      "REPEATED_QUERY_PARAMETER",
      "page",
    ],
    ["a missing required query param", "/api/catalog", "MISSING_REQUIRED_PARAMETER", "page"],
    [
      "a non-numeric number query param",
      "/api/catalog?page=abc",
      "INVALID_PARAMETER_VALUE",
      "page",
    ],
    [
      "a non-boolean boolean query param",
      "/api/catalog?page=1&includeArchived=maybe",
      "INVALID_PARAMETER_VALUE",
      "includeArchived",
    ],
    [
      "a non-numeric number route param",
      "/api/catalog/not-a-number",
      "INVALID_PARAMETER_VALUE",
      "id",
    ],
  ])("answers 400 for %s", async (_, route, code, parameter) => {
    const response = await catalogApp().request(route);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code,
      message: expect.stringContaining(parameter) as string,
    });
  });
});

interface ItemsContract extends Contract<"Items"> {
  GetItem: Endpoint<{ method: "GET"; route: "/api/items"; response: { readonly id: string } }>;
  CreateItem: Endpoint<{ method: "POST"; route: "/api/items"; response: { readonly id: string } }>;
  RemoveItem: Endpoint<{ method: "DELETE"; route: "/api/items"; response: void }>;
}

describe("responses", () => {
  it("returns file responses as file bodies", async () => {
    const app = new Hono();
    registerRivetHonoRoutes<DirectoryContract>(app, directory, {
      group: "directory",
      handlers: directoryHandlers,
    });

    const response = await app.request("/api/directory/export");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv");
    await expect(response.text()).resolves.toBe("id,name\n1,Ada\n");
  });

  it("falls back to the method-default success status when the contract JSON has no 2xx response", async () => {
    // The lowerer always emits a success response, so only hand-written
    // contract JSON reaches this fallback: POST -> 201, DELETE void -> 204, else 200.
    const endpoint = (name: string, httpMethod: string, statusCodes: readonly number[]) => ({
      name,
      httpMethod,
      routeTemplate: "/api/items",
      controllerName: "items",
      params: [],
      responses: statusCodes.map((statusCode) => ({ statusCode })),
    });
    const withoutSuccessResponses = {
      endpoints: [
        endpoint("getItem", "GET", [404]),
        endpoint("createItem", "POST", [409]),
        endpoint("removeItem", "DELETE", []),
      ],
    };
    const app = new Hono();
    registerRivetHonoRoutes<ItemsContract>(app, withoutSuccessResponses, {
      group: "items",
      handlers: {
        GetItem: async () => ({ id: "item_1" }),
        CreateItem: async () => ({ id: "item_1" }),
        RemoveItem: async () => undefined,
      },
    });

    const get = await app.request("/api/items");
    expect(get.status).toBe(200);
    await expect(get.json()).resolves.toEqual({ id: "item_1" });
    const post = await app.request("/api/items", { method: "POST" });
    expect(post.status).toBe(201);
    await expect(post.json()).resolves.toEqual({ id: "item_1" });
    const remove = await app.request("/api/items", { method: "DELETE" });
    expect(remove.status).toBe(204);
    await expect(remove.text()).resolves.toBe("");
  });
});

const sharedConflict = rivetHttpError(409, { code: "conflict" } satisfies ConflictDto);

describe("RivetHttpError", () => {
  it("serializes an explicit non-2xx status thrown by a handler", async () => {
    class ConflictingSearchHandler implements RivetInvokable<DirectoryContract, "Search"> {
      public async handle(): Promise<DirectorySearchResponse> {
        throw rivetHttpError(409, { code: "conflict" } satisfies ConflictDto);
      }
    }
    const app = new Hono();
    registerRivetHonoRoutes<DirectoryContract>(app, directory, {
      group: "directory",
      handlers: { ...directoryHandlers, Search: ConflictingSearchHandler },
    });

    const response = await search(app);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ code: "conflict" });
  });

  it("refuses body-forbidding statuses (204/205/304)", () => {
    for (const status of [204, 205, 304] as const) {
      // @ts-expect-error — an HTTPException status always carries content.
      expect(() => rivetHttpError(status, { detail: "must not exist" })).toThrow(TypeError);
    }
  });

  it("answers from its route even when the app maps other errors to a structured 500", async () => {
    const app = new Hono();
    app.onError((_error, context) =>
      context.json({ code: "internal_error", message: "Unexpected error." }, 500),
    );
    registerRivetHonoRoutes<DirectoryContract>(app, directory, {
      group: "directory",
      handlers: {
        ...directoryHandlers,
        Search: async () => {
          throw rivetHttpError(409, { code: "conflict" } satisfies ConflictDto, {
            headers: { "x-retry-after": "5", "set-cookie": ["a=1", "b=2"] },
          });
        },
        Health: async () => {
          throw new Error("boom");
        },
      },
    });

    const conflict = await search(app);
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get("x-retry-after")).toBe("5");
    expect(conflict.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    await expect(conflict.json()).resolves.toEqual({ code: "conflict" });

    const failure = await app.request("/api/directory/health");
    expect(failure.status).toBe(500);
    await expect(failure.json()).resolves.toEqual({
      code: "internal_error",
      message: "Unexpected error.",
    });
  });

  it("keeps headers middleware set before next() on thrown and binding-error responses", async () => {
    const app = new Hono();
    app.use(async (context, next) => {
      context.header("x-mw", "yes");
      await next();
    });
    registerRivetHonoRoutes<DirectoryContract>(app, directory, {
      group: "directory",
      handlers: {
        ...directoryHandlers,
        Health: async () => {
          throw rivetHttpError(409, { code: "conflict" } satisfies ConflictDto, {
            headers: { "x-retry-after": "5" },
          });
        },
      },
    });

    const thrown = await app.request("/api/directory/health");
    expect(thrown.status).toBe(409);
    expect(thrown.headers.get("x-mw")).toBe("yes");
    expect(thrown.headers.get("x-retry-after")).toBe("5");
    await expect(thrown.json()).resolves.toEqual({ code: "conflict" });

    const binding = await postJson(app, "/api/directory/search", "{not json");
    expect(binding.status).toBe(400);
    expect(binding.headers.get("x-mw")).toBe("yes");
  });

  it("answers every request that throws the same error instance", async () => {
    const app = new Hono();
    registerRivetHonoRoutes<DirectoryContract>(app, directory, {
      group: "directory",
      handlers: {
        ...directoryHandlers,
        Health: async () => {
          throw sharedConflict;
        },
      },
    });

    for (const _ of [1, 2]) {
      const response = await app.request("/api/directory/health");
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ code: "conflict" });
    }
    await expect(sharedConflict.getResponse().json()).resolves.toEqual({ code: "conflict" });
    await expect(sharedConflict.getResponse().json()).resolves.toEqual({ code: "conflict" });
  });

  it("is recognised as an HTTPException by Hono error handling when route middleware throws it", async () => {
    const app = new Hono();
    app.onError((error, context) =>
      error instanceof HTTPException
        ? error.getResponse()
        : context.json({ code: "internal_error", message: "Unexpected error." }, 500),
    );
    registerRivetHonoRoutes<DirectoryContract>(app, directory, {
      group: "directory",
      handlers: {
        ...directoryHandlers,
        Health: {
          handler: healthHandler,
          middleware: [
            async () => {
              throw rivetHttpError(401, { code: "unauthorized" });
            },
          ],
        },
      },
    });

    const response = await app.request("/api/directory/health");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ code: "unauthorized" });
  });
});
