import { Hono } from "hono";
import { expect, test } from "vitest";
import type { Contract, Endpoint } from "../../src/domain/authoring-types.js";
import { registerRivetHonoRoutes, rivetHttpError, type RivetInvokable } from "../../src/hono.js";
import type { RivetHandler } from "../../src/index.js";

interface DirectorySearchRequest {
  readonly query: string;
}

interface DirectorySearchResponse {
  readonly query: string;
}

interface DirectoryStatusResponse {
  readonly status: "ok";
}

interface ConflictDto {
  readonly code: "conflict";
}

interface SubmitFormRequest {
  readonly name: string;
  readonly email: string;
}

interface UploadDocumentRequest {
  readonly file: File;
  readonly title: string;
  readonly description: string;
}

interface DirectoryContract extends Contract<"DirectoryContract"> {
  Search: Endpoint<{
    method: "POST";
    route: "/api/directory/search";
    input: DirectorySearchRequest;
    response: DirectorySearchResponse;
    successStatus: 201;
    errors: [{ status: 409; response: ConflictDto }];
  }>;

  Health: Endpoint<{
    method: "GET";
    route: "/api/directory/health";
    response: DirectoryStatusResponse;
  }>;

  Export: Endpoint<{
    method: "GET";
    route: "/api/directory/export";
    fileResponse: true;
    fileContentType: "text/csv";
    response: void;
  }>;

  SubmitForm: Endpoint<{
    method: "POST";
    route: "/api/directory/forms";
    input: SubmitFormRequest;
    response: DirectorySearchResponse;
    formEncoded: true;
  }>;

  UploadDocument: Endpoint<{
    method: "PUT";
    route: "/api/directory/documents/{documentId}";
    params: { documentId: string };
    input: UploadDocumentRequest;
    response: void;
    acceptsFile: true;
  }>;
}

const searchEchoHandler: RivetHandler<DirectoryContract, "Search"> = async ({ body }) => ({
  query: body.query,
});

const healthHandler: RivetHandler<DirectoryContract, "Health"> = async () => ({
  status: "ok",
});

const exportHandler: RivetHandler<DirectoryContract, "Export"> = async () =>
  new Blob(["id,name\n1,Ada\n"], { type: "text/csv" });

const submitFormHandler: RivetHandler<DirectoryContract, "SubmitForm"> = async ({ body }) => ({
  query: `${body.name}:${body.email}`,
});

const uploadDocumentNoopHandler: RivetHandler<DirectoryContract, "UploadDocument"> = async () =>
  undefined;

const contract = {
  endpoints: [
    {
      name: "search",
      httpMethod: "POST",
      routeTemplate: "/api/directory/search",
      group: "directory",
      params: [
        {
          name: "body",
          source: "body",
        },
      ],
      responses: [
        {
          statusCode: 201,
        },
        {
          statusCode: 409,
        },
      ],
    },
    {
      name: "health",
      httpMethod: "GET",
      routeTemplate: "/api/directory/health",
      group: "directory",
      params: [],
      responses: [
        {
          statusCode: 200,
        },
      ],
    },
    {
      name: "export",
      httpMethod: "GET",
      routeTemplate: "/api/directory/export",
      group: "directory",
      params: [],
      responses: [
        {
          statusCode: 200,
        },
      ],
      fileContentType: "text/csv",
    },
    {
      name: "submitForm",
      httpMethod: "POST",
      routeTemplate: "/api/directory/forms",
      group: "directory",
      params: [
        {
          name: "body",
          source: "body",
        },
      ],
      responses: [
        {
          statusCode: 200,
        },
      ],
      isFormEncoded: true,
    },
    {
      name: "uploadDocument",
      httpMethod: "PUT",
      routeTemplate: "/api/directory/documents/{documentId}",
      group: "directory",
      params: [
        {
          name: "documentId",
          source: "route",
        },
        {
          name: "file",
          source: "file",
        },
        {
          name: "title",
          source: "formField",
        },
        {
          name: "description",
          source: "formField",
        },
      ],
      responses: [
        {
          statusCode: 204,
        },
      ],
    },
  ],
} as const;

test("registerRivetHonoRoutes uses plain function handlers directly", async () => {
  const app = new Hono();

  registerRivetHonoRoutes<DirectoryContract>(app, contract, {
    group: "directory",
    handlers: {
      Search: searchEchoHandler,
      Health: healthHandler,
      Export: exportHandler,
      SubmitForm: submitFormHandler,
      UploadDocument: uploadDocumentNoopHandler,
    },
  });

  const response = await app.request("/api/directory/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: "Ada" }),
  });

  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toEqual({
    query: "Ada",
  });
});

test("registerRivetHonoRoutes instantiates zero-arg class handlers once per request", async () => {
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
  registerRivetHonoRoutes<DirectoryContract>(app, contract, {
    group: "directory",
    handlers: {
      Search: searchEchoHandler,
      Health: HealthHandler,
      Export: exportHandler,
      SubmitForm: submitFormHandler,
      UploadDocument: uploadDocumentNoopHandler,
    },
  });

  const firstResponse = await app.request("/api/directory/health");
  expect(firstResponse.status).toBe(200);
  await expect(firstResponse.json()).resolves.toEqual({ status: "ok" });

  const secondResponse = await app.request("/api/directory/health");
  expect(secondResponse.status).toBe(200);
  await expect(secondResponse.json()).resolves.toEqual({ status: "ok" });

  expect(constructorCalls).toBe(2);
});

test("registerRivetHonoRoutes resolves class handlers through resolveHandler at bootstrap", async () => {
  class SearchHandler implements RivetInvokable<DirectoryContract, "Search"> {
    public constructor(private readonly prefix: string) {}

    public async handle({
      body,
    }: {
      body: DirectorySearchRequest;
    }): Promise<DirectorySearchResponse> {
      return {
        query: `${this.prefix}:${body.query}`,
      };
    }
  }

  const app = new Hono();
  registerRivetHonoRoutes<DirectoryContract>(app, contract, {
    group: "directory",
    handlers: {
      Search: SearchHandler,
      Health: healthHandler,
      Export: exportHandler,
      SubmitForm: submitFormHandler,
      UploadDocument: uploadDocumentNoopHandler,
    },
    resolveHandler: (Handler) => new Handler("directory"),
  });

  const response = await app.request("/api/directory/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: "Ada" }),
  });

  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toEqual({
    query: "directory:Ada",
  });
});

test("registerRivetHonoRoutes supports rich endpoint entries with Hono middleware", async () => {
  const app = new Hono();

  registerRivetHonoRoutes<DirectoryContract>(app, contract, {
    group: "directory",
    handlers: {
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
      Health: healthHandler,
      Export: exportHandler,
      SubmitForm: submitFormHandler,
      UploadDocument: uploadDocumentNoopHandler,
    },
  });

  const blockedResponse = await app.request("/api/directory/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: "Ada" }),
  });

  expect(blockedResponse.status).toBe(403);
  await expect(blockedResponse.json()).resolves.toEqual({ code: "forbidden" });

  const allowedResponse = await app.request("/api/directory/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-allow-search": "yes",
    },
    body: JSON.stringify({ query: "Ada" }),
  });

  expect(allowedResponse.status).toBe(201);
  await expect(allowedResponse.json()).resolves.toEqual({
    query: "Ada",
  });
});

test("registerRivetHonoRoutes throws when a class handler needs DI but no resolver is supplied", () => {
  class SearchHandler implements RivetInvokable<DirectoryContract, "Search"> {
    public constructor(private readonly prefix: string) {}

    public async handle({
      body,
    }: {
      body: DirectorySearchRequest;
    }): Promise<DirectorySearchResponse> {
      return {
        query: `${this.prefix}:${body.query}`,
      };
    }
  }

  const app = new Hono();

  expect(() =>
    registerRivetHonoRoutes<DirectoryContract>(app, contract, {
      group: "directory",
      handlers: {
        Search: SearchHandler,
        Health: healthHandler,
        Export: exportHandler,
        SubmitForm: submitFormHandler,
        UploadDocument: uploadDocumentNoopHandler,
      },
    }),
  ).toThrow(
    'Handler class "SearchHandler" for endpoint "search" requires constructor dependencies. Supply "resolveHandler" at registration.',
  );
});

test("registerRivetHonoRoutes serializes explicit non-2xx Rivet HTTP errors", async () => {
  class SearchHandler implements RivetInvokable<DirectoryContract, "Search"> {
    public async handle(): Promise<DirectorySearchResponse> {
      throw rivetHttpError(409, { code: "conflict" } satisfies ConflictDto);
    }
  }

  const app = new Hono();
  registerRivetHonoRoutes<DirectoryContract>(app, contract, {
    group: "directory",
    handlers: {
      Search: SearchHandler,
      Health: healthHandler,
      Export: exportHandler,
      SubmitForm: submitFormHandler,
      UploadDocument: uploadDocumentNoopHandler,
    },
  });

  const response = await app.request("/api/directory/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: "Ada" }),
  });

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({ code: "conflict" });
});

test("registerRivetHonoRoutes returns file responses as file bodies", async () => {
  const app = new Hono();
  registerRivetHonoRoutes<DirectoryContract>(app, contract, {
    group: "directory",
    handlers: {
      Search: searchEchoHandler,
      Health: healthHandler,
      Export: exportHandler,
      SubmitForm: submitFormHandler,
      UploadDocument: uploadDocumentNoopHandler,
    },
  });

  const response = await app.request("/api/directory/export");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/csv");
  await expect(response.text()).resolves.toBe("id,name\n1,Ada\n");
});

test("registerRivetHonoRoutes parses form-encoded bodies into handler input", async () => {
  const app = new Hono();
  registerRivetHonoRoutes<DirectoryContract>(app, contract, {
    group: "directory",
    handlers: {
      Search: searchEchoHandler,
      Health: healthHandler,
      Export: exportHandler,
      SubmitForm: submitFormHandler,
      UploadDocument: uploadDocumentNoopHandler,
    },
  });

  const form = new URLSearchParams();
  form.set("name", "Jane");
  form.set("email", "jane@example.com");

  const response = await app.request("/api/directory/forms", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    query: "Jane:jane@example.com",
  });
});

test("registerRivetHonoRoutes parses multipart inputs into body plus params", async () => {
  const app = new Hono();
  registerRivetHonoRoutes<DirectoryContract>(app, contract, {
    group: "directory",
    handlers: {
      Search: searchEchoHandler,
      Health: healthHandler,
      Export: exportHandler,
      SubmitForm: submitFormHandler,
      UploadDocument: async ({ body, params }) => {
        expect(params.documentId).toBe("doc_123");
        expect(body.title).toBe("Quarterly report");
        expect(body.description).toBe("Draft");
        expect(body.file).toBeInstanceOf(File);
        expect(await body.file.text()).toBe("hello");
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
});

test("registerRivetHonoRoutes fails fast when a selected endpoint handler is missing", () => {
  const app = new Hono();

  expect(() =>
    registerRivetHonoRoutes<DirectoryContract>(app, contract, {
      group: "directory",
      handlers: {
        Search: searchEchoHandler,
      },
    }),
  ).toThrow('No handler was provided for endpoint "health".');
});

test("registerRivetHonoRoutes fails fast on unused handlers", () => {
  const app = new Hono();

  expect(() =>
    registerRivetHonoRoutes<DirectoryContract>(app, contract, {
      group: "directory",
      handlers: {
        Search: searchEchoHandler,
        Health: healthHandler,
        Export: exportHandler,
        SubmitForm: submitFormHandler,
        UploadDocument: uploadDocumentNoopHandler,
        Unknown: async () => ({ status: "ok" as const }),
      } as never,
    }),
  ).toThrow("Unused handlers were provided: Unknown.");
});

// -- Default success-status fallback table (N4): POST -> 201; DELETE void -> 204; else 200 --

interface StatusTableContract extends Contract<"StatusTableContract"> {
  CreateItem: Endpoint<{
    method: "POST";
    route: "/api/items";
    input: { readonly name: string };
    response: { readonly id: string };
  }>;

  GetItem: Endpoint<{
    method: "GET";
    route: "/api/items";
    response: { readonly id: string };
  }>;

  RemoveItem: Endpoint<{
    method: "DELETE";
    route: "/api/items";
    response: void;
  }>;
}

test("registerRivetHonoRoutes falls back to the method default status when responses carry no 2xx entry", async () => {
  // Endpoints deliberately omit success responses so the adapter's
  // method-default table (shared with the lowerer and SuccessStatus) is hit.
  const statusTableContract = {
    endpoints: [
      {
        name: "createItem",
        httpMethod: "POST",
        routeTemplate: "/api/items",
        group: "items",
        params: [{ name: "body", source: "body" }],
        responses: [],
      },
      {
        name: "getItem",
        httpMethod: "GET",
        routeTemplate: "/api/items",
        group: "items",
        params: [],
        responses: [],
      },
      {
        name: "removeItem",
        httpMethod: "DELETE",
        routeTemplate: "/api/items",
        group: "items",
        params: [],
        responses: [],
      },
    ],
  } as const;

  const app = new Hono();
  registerRivetHonoRoutes<StatusTableContract>(app, statusTableContract, {
    group: "items",
    handlers: {
      CreateItem: async () => ({ id: "item_1" }),
      GetItem: async () => ({ id: "item_1" }),
      RemoveItem: async () => undefined,
    },
  });

  const postResponse = await app.request("/api/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ada" }),
  });
  expect(postResponse.status).toBe(201);
  await expect(postResponse.json()).resolves.toEqual({ id: "item_1" });

  const getResponse = await app.request("/api/items");
  expect(getResponse.status).toBe(200);
  await expect(getResponse.json()).resolves.toEqual({ id: "item_1" });

  const deleteResponse = await app.request("/api/items", { method: "DELETE" });
  expect(deleteResponse.status).toBe(204);
  await expect(deleteResponse.text()).resolves.toBe("");
});

// Relocated from scaffold-mock.lifecycle.test.ts: this is a Hono runtime
// behavior test (group filtering + empty-body responses), not a scaffold test.
test("filters endpoints by group and returns empty responses correctly", async () => {
  interface MultiContract extends Contract<"MultiContract"> {
    Ping: Endpoint<{
      method: "POST";
      route: "/api/ping";
      response: void;
    }>;
    Health: Endpoint<{
      method: "GET";
      route: "/api/health";
      response: { status: "ok" };
    }>;
  }

  const pingHandler: RivetHandler<MultiContract, "Ping"> = async () => undefined;

  const app = new Hono();
  registerRivetHonoRoutes<MultiContract>(
    app,
    {
      endpoints: [
        {
          name: "ping",
          httpMethod: "POST",
          routeTemplate: "/api/ping",
          group: "pet",
          params: [],
          responses: [{ statusCode: 204 }],
        },
        {
          name: "health",
          httpMethod: "GET",
          routeTemplate: "/api/health",
          group: "summary",
          params: [],
          responses: [{ statusCode: 200 }],
        },
      ],
    },
    {
      handlers: {
        Ping: pingHandler,
      },
      group: "pet",
    },
  );

  const pingResponse = await app.request("http://local/api/ping", { method: "POST" });
  const healthResponse = await app.request("http://local/api/health", { method: "GET" });

  expect(pingResponse.status).toBe(204);
  await expect(pingResponse.text()).resolves.toBe("");
  expect(healthResponse.status).toBe(404);
});

// -- H1/H2: typed query/route binding honesty --
// For bodyless methods the lowerer turns `input` into query params (and the
// type level maps input -> { query }), so the adapter must deliver values
// coerced to the contract-declared types, not raw first-value strings.

interface CatalogItemDto {
  readonly id: number;
}

interface CatalogContract extends Contract<"CatalogContract"> {
  GetItem: Endpoint<{
    method: "GET";
    route: "/api/catalog/{id}";
    params: { readonly id: number };
    response: CatalogItemDto;
  }>;

  ListItems: Endpoint<{
    method: "GET";
    route: "/api/catalog";
    input: {
      readonly page: number;
      readonly includeArchived?: boolean;
      readonly tags?: readonly string[];
      readonly q?: string;
    };
    response: {
      readonly page: number;
      readonly includeArchived?: boolean;
      readonly tags?: readonly string[];
      readonly q?: string;
    };
  }>;
}

const catalogContract = {
  endpoints: [
    {
      name: "getItem",
      httpMethod: "GET",
      routeTemplate: "/api/catalog/{id}",
      group: "catalog",
      params: [
        {
          name: "id",
          source: "route",
          type: { kind: "primitive", type: "number" },
          isOptional: false,
        },
      ],
      responses: [{ statusCode: 200 }],
    },
    {
      name: "listItems",
      httpMethod: "GET",
      routeTemplate: "/api/catalog",
      group: "catalog",
      params: [
        {
          name: "page",
          source: "query",
          type: { kind: "primitive", type: "number" },
          isOptional: false,
        },
        {
          name: "includeArchived",
          source: "query",
          type: { kind: "primitive", type: "boolean" },
          isOptional: true,
        },
        {
          name: "tags",
          source: "query",
          type: { kind: "array", element: { kind: "primitive", type: "string" } },
          isOptional: true,
        },
        {
          name: "q",
          source: "query",
          type: { kind: "nullable", inner: { kind: "primitive", type: "string" } },
          isOptional: true,
        },
      ],
      responses: [{ statusCode: 200 }],
    },
  ],
} as const;

const buildCatalogApp = (): Hono => {
  const app = new Hono();
  registerRivetHonoRoutes<CatalogContract>(app, catalogContract, {
    group: "catalog",
    handlers: {
      GetItem: async ({ params }) => ({ id: params.id }),
      ListItems: async ({ query }) => ({ ...query }),
    },
  });
  return app;
};

test("GET input round-trips as typed query values (H1 runtime + H2 coercion)", async () => {
  const app = buildCatalogApp();

  const response = await app.request("/api/catalog?page=2&includeArchived=true&tags=a&tags=b");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    page: 2,
    includeArchived: true,
    tags: ["a", "b"],
  });
});

test("single value for an array-typed query param arrives as a one-element array (H2)", async () => {
  const app = buildCatalogApp();

  const response = await app.request("/api/catalog?page=1&tags=solo");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    page: 1,
    tags: ["solo"],
  });
});

test("repeated values for a non-array query param return 400 (H2, loud)", async () => {
  const app = buildCatalogApp();

  const response = await app.request("/api/catalog?page=1&page=2");

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    code: "REPEATED_QUERY_PARAMETER",
    message: expect.stringContaining("page") as string,
  });
});

test("missing required query param returns 400, not undefined-into-handler (H2)", async () => {
  const app = buildCatalogApp();

  const response = await app.request("/api/catalog");

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    code: "MISSING_REQUIRED_PARAMETER",
    message: expect.stringContaining("page") as string,
  });
});

test("non-numeric value for a number query param returns 400 (H2)", async () => {
  const app = buildCatalogApp();

  const response = await app.request("/api/catalog?page=abc");

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    code: "INVALID_PARAMETER_VALUE",
    message: expect.stringContaining("page") as string,
  });
});

test("non-boolean value for a boolean query param returns 400 (H2)", async () => {
  const app = buildCatalogApp();

  const response = await app.request("/api/catalog?page=1&includeArchived=maybe");

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    code: "INVALID_PARAMETER_VALUE",
    message: expect.stringContaining("includeArchived") as string,
  });
});

test("route params coerce to the contract-declared number type (H2)", async () => {
  const app = buildCatalogApp();

  const response = await app.request("/api/catalog/42");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ id: 42 });
});

test("non-numeric value for a number route param returns 400 (H2)", async () => {
  const app = buildCatalogApp();

  const response = await app.request("/api/catalog/not-a-number");

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    code: "INVALID_PARAMETER_VALUE",
    message: expect.stringContaining("id") as string,
  });
});

// -- H3: invalid JSON body --

test("malformed JSON body returns 400 with a structured error and never invokes the handler (H3)", async () => {
  let handlerCalls = 0;

  const app = new Hono();
  registerRivetHonoRoutes<DirectoryContract>(app, contract, {
    group: "directory",
    handlers: {
      Search: async ({ body }) => {
        handlerCalls += 1;
        return { query: body.query };
      },
      Health: healthHandler,
      Export: exportHandler,
      SubmitForm: submitFormHandler,
      UploadDocument: uploadDocumentNoopHandler,
    },
  });

  const response = await app.request("/api/directory/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    code: "INVALID_REQUEST_BODY",
    message: expect.stringContaining("search") as string,
  });
  expect(handlerCalls).toBe(0);
});

// -- H4: no-`group` multi-contract registration --

interface PetsAndOwnersContract extends Contract<"PetsAndOwnersContract"> {
  ListPets: Endpoint<{
    method: "GET";
    route: "/api/pets";
    response: { readonly kind: "pets" };
  }>;

  ListOwners: Endpoint<{
    method: "GET";
    route: "/api/owners";
    response: { readonly kind: "owners" };
  }>;
}

test("omitting group mounts multiple contracts' endpoints at their own routes (H4)", async () => {
  const multiGroupContract = {
    endpoints: [
      {
        name: "listPets",
        httpMethod: "GET",
        routeTemplate: "/api/pets",
        group: "pets",
        params: [],
        responses: [{ statusCode: 200 }],
      },
      {
        name: "listOwners",
        httpMethod: "GET",
        routeTemplate: "/api/owners",
        group: "owners",
        params: [],
        responses: [{ statusCode: 200 }],
      },
    ],
  } as const;

  const app = new Hono();
  registerRivetHonoRoutes<PetsAndOwnersContract>(app, multiGroupContract, {
    handlers: {
      ListPets: async () => ({ kind: "pets" as const }),
      ListOwners: async () => ({ kind: "owners" as const }),
    },
  });

  const petsResponse = await app.request("/api/pets");
  expect(petsResponse.status).toBe(200);
  await expect(petsResponse.json()).resolves.toEqual({ kind: "pets" });

  const ownersResponse = await app.request("/api/owners");
  expect(ownersResponse.status).toBe(200);
  await expect(ownersResponse.json()).resolves.toEqual({ kind: "owners" });
});

test("omitting group fails loudly when one handler key matches endpoints in several groups (H4)", () => {
  const collidingNamesContract = {
    endpoints: [
      {
        name: "get",
        httpMethod: "GET",
        routeTemplate: "/api/pets",
        group: "pets",
        params: [],
        responses: [{ statusCode: 200 }],
      },
      {
        name: "get",
        httpMethod: "GET",
        routeTemplate: "/api/owners",
        group: "owners",
        params: [],
        responses: [{ statusCode: 200 }],
      },
    ],
  } as const;

  const app = new Hono();

  expect(() =>
    registerRivetHonoRoutes(app, collidingNamesContract, {
      handlers: {
        Get: async () => ({}),
      } as never,
    }),
  ).toThrow(/matched multiple endpoints/);
});

test("duplicate route and method across contracts fails loudly at registration time (H4)", () => {
  const duplicateRouteContract = {
    endpoints: [
      {
        name: "listPets",
        httpMethod: "GET",
        routeTemplate: "/api/shared",
        group: "pets",
        params: [],
        responses: [{ statusCode: 200 }],
      },
      {
        name: "listOwners",
        httpMethod: "GET",
        routeTemplate: "/api/shared",
        group: "owners",
        params: [],
        responses: [{ statusCode: 200 }],
      },
    ],
  } as const;

  const app = new Hono();

  expect(() =>
    registerRivetHonoRoutes(app, duplicateRouteContract, {
      handlers: {
        ListPets: async () => ({}),
        ListOwners: async () => ({}),
      } as never,
    }),
  ).toThrow(/Duplicate route/);
});

// -- H5: missing-2xx fallback + bodyless error statuses --

test("responses containing only error statuses fall back to the method-default success status (H5)", async () => {
  const errorOnlyContract = {
    endpoints: [
      {
        name: "getThing",
        httpMethod: "GET",
        routeTemplate: "/api/things",
        group: "things",
        params: [],
        responses: [{ statusCode: 404 }],
      },
      {
        name: "createThing",
        httpMethod: "POST",
        routeTemplate: "/api/things",
        group: "things",
        params: [],
        responses: [{ statusCode: 409 }],
      },
    ],
  } as const;

  interface ThingsContract extends Contract<"ThingsContract"> {
    GetThing: Endpoint<{ method: "GET"; route: "/api/things"; response: { readonly ok: true } }>;
    CreateThing: Endpoint<{
      method: "POST";
      route: "/api/things";
      response: { readonly ok: true };
    }>;
  }

  const app = new Hono();
  registerRivetHonoRoutes<ThingsContract>(app, errorOnlyContract, {
    group: "things",
    handlers: {
      GetThing: async () => ({ ok: true as const }),
      CreateThing: async () => ({ ok: true as const }),
    },
  });

  const getResponse = await app.request("/api/things");
  expect(getResponse.status).toBe(200);

  const postResponse = await app.request("/api/things", { method: "POST" });
  expect(postResponse.status).toBe(201);
});

test("rivetHttpError rejects body-forbidding statuses (204/205/304) carrying data at the call site (H5)", async () => {
  for (const status of [204, 205, 304]) {
    expect(() => rivetHttpError(status, { detail: "must not exist" })).toThrow(
      new RegExp(`${status}.*must not carry a body`),
    );
  }

  // Bodyless statuses without data stay constructible and serializable.
  const app = new Hono();
  registerRivetHonoRoutes<DirectoryContract>(app, contract, {
    group: "directory",
    handlers: {
      Search: async () => {
        throw rivetHttpError(304, undefined);
      },
      Health: healthHandler,
      Export: exportHandler,
      SubmitForm: submitFormHandler,
      UploadDocument: uploadDocumentNoopHandler,
    },
  });

  const response = await app.request("/api/directory/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "Ada" }),
  });

  expect(response.status).toBe(304);
  await expect(response.text()).resolves.toBe("");
});

// -- H6: missing multipart field --

test("missing declared multipart file field returns 400, not undefined-into-handler (H6)", async () => {
  let handlerCalls = 0;

  const app = new Hono();
  registerRivetHonoRoutes<DirectoryContract>(app, contract, {
    group: "directory",
    handlers: {
      Search: searchEchoHandler,
      Health: healthHandler,
      Export: exportHandler,
      SubmitForm: submitFormHandler,
      UploadDocument: async () => {
        handlerCalls += 1;
      },
    },
  });

  const form = new FormData();
  form.set("title", "Quarterly report");
  form.set("description", "Draft");
  // The declared "file" field is deliberately absent.

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
