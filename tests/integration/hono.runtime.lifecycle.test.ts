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

test("registerRivetHonoRoutes instantiates zero-arg class handlers once by default", async () => {
  class HealthHandler implements RivetInvokable<DirectoryContract, "Health"> {
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

  const response = await app.request("/api/directory/health");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: "ok" });
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
