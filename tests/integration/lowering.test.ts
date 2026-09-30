import fs from "node:fs/promises";
import path from "node:path";
import { expectValidContractDocument } from "../contract-schema.js";
import { type ContractJson, lowerFixture, lowerSource } from "../support/lower.js";
import { AUTHORING_TYPES, fixturePath, PROJECT_ROOT } from "../support/paths.js";

type EndpointJson = ContractJson["endpoints"][number];

const endpointNamed = (document: ContractJson, name: string): EndpointJson => {
  const endpoint = document.endpoints.find((candidate) => candidate.name === name);
  if (!endpoint) {
    throw new Error(`No endpoint "${name}" in [${document.endpoints.map((e) => e.name)}].`);
  }
  return endpoint;
};

const examplesAt = (endpoint: EndpointJson, status: number) =>
  endpoint.responses.find((response) => response.statusCode === status)?.examples;

/** An error-severity diagnostic: a warning with the same code must fail the test. */
const errorDiagnostic = (fields: Record<string, unknown>) =>
  expect.objectContaining({ severity: "error", ...fields });

const example = (value: unknown, mediaType = "application/json") => ({
  mediaType,
  json: JSON.stringify(value),
});

describe("contract discovery", () => {
  it("discovers the members fixture and lowers its endpoints, types and security", () => {
    const { lowered, document } = lowerFixture("members-contract");

    expect(lowered.diagnostics).toEqual([]);
    expectValidContractDocument(document);
    expect(lowered.contracts.map((contract) => contract.name)).toEqual(["MembersContract"]);
    expect(lowered.contracts[0]?.endpoints.map((endpoint) => endpoint.name)).toEqual([
      "List",
      "Invite",
      "Remove",
      "UpdateRole",
      "Health",
    ]);
    expect(document.types.map((type) => type.name).sort()).toEqual([
      "InviteMemberRequest",
      "InviteMemberResponse",
      "MemberDto",
      "NotFoundDto",
      "PagedResult",
      "UpdateRoleRequest",
      "ValidationErrorDto",
    ]);

    const statuses = (name: string) =>
      endpointNamed(document, name).responses.map((response) => response.statusCode);
    expect(endpointNamed(document, "list")).toMatchObject({
      httpMethod: "GET",
      routeTemplate: "/api/members",
      controllerName: "members",
      description: "List all team members",
      params: [],
    });
    expect(statuses("list")).toEqual([200]);
    expect(endpointNamed(document, "invite")).toMatchObject({
      httpMethod: "POST",
      routeTemplate: "/api/members",
      controllerName: "members",
      params: [expect.objectContaining({ name: "body", source: "body", isOptional: false })],
      security: expect.objectContaining({ scheme: "admin" }),
      responses: [
        expect.objectContaining({ statusCode: 201 }),
        expect.objectContaining({ statusCode: 422, description: "Validation failed" }),
      ],
    });
    expect(endpointNamed(document, "remove")).toMatchObject({
      httpMethod: "DELETE",
      routeTemplate: "/api/members/{id}",
      params: [expect.objectContaining({ name: "id", source: "route", isOptional: false })],
    });
    expect(statuses("remove")).toEqual([204, 404]);
    expect(endpointNamed(document, "updateRole")).toMatchObject({
      httpMethod: "PUT",
      routeTemplate: "/api/members/{id}/role",
    });
    expect(statuses("updateRole")).toEqual([204, 404]);
    expect(endpointNamed(document, "health")).toMatchObject({
      httpMethod: "GET",
      routeTemplate: "/api/health",
      description: "Health check",
      security: expect.objectContaining({ isAnonymous: true }),
    });
  });

  it("recognises Contract and Endpoint through renamed imports, and literals through aliases", async () => {
    const { lowered, document } = await lowerSource(`
import type { Contract as C, Endpoint as E } from "${AUTHORING_TYPES}";

type Name = "Users";
type Get = "GET";
type PingRoute = "/api/ping";

export interface UsersContract extends C<Name> {
  Ping: E<{ method: Get; route: PingRoute; response: void }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    expect(lowered.contracts.map((contract) => contract.name)).toEqual(["Users"]);
    expect(document.endpoints).toEqual([
      expect.objectContaining({ name: "ping", httpMethod: "GET", routeTemplate: "/api/ping" }),
    ]);
  });

  it("does not treat a local type named Contract as the rivet-ts Contract", async () => {
    const { entryPath, lowered } = await lowerSource(`
import type { Endpoint } from "${AUTHORING_TYPES}";

type Contract<TName extends string> = { readonly label?: TName };

export interface UsersContract extends Contract<"Users"> {
  Ping: Endpoint<{ method: "GET"; route: "/api/ping"; response: void }>;
}

export interface LeaseContract extends Contract<"Lease"> {
  id: string;
}
`);

    expect(lowered.contracts).toEqual([]);
    // Endpoint members mean a contract was intended; a plain domain type is left alone.
    expect(lowered.diagnostics).toEqual([
      errorDiagnostic({ code: "FOREIGN_AUTHORING_TYPE", filePath: entryPath, line: 6 }),
    ]);
  });

  it("reports Contract and Endpoint imported from a vendored copy instead of lowering nothing", async () => {
    const vendored = await fs.readFile(
      path.join(PROJECT_ROOT, "src", "domain", "authoring-types.ts"),
      "utf8",
    );
    const { entryPath, lowered } = await lowerSource(
      `
import type { Contract, Endpoint } from "./vendor/rivet.js";

export interface UsersContract extends Contract<"Users"> {
  Ping: Endpoint<{ method: "GET"; route: "/api/ping"; response: void }>;
}
`,
      { "vendor/rivet.ts": vendored },
    );

    expect(lowered.contracts).toEqual([]);
    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual([
      errorDiagnostic({
        code: "FOREIGN_AUTHORING_TYPE",
        filePath: entryPath,
        line: 4,
        message: expect.stringContaining(
          'import Contract and Endpoint from "@maxanstey-meridian/rivet-ts"',
        ),
      }),
    ]);
  });

  it("reports an Endpoint imported from elsewhere inside a rivet-ts Contract", async () => {
    const { entryPath, lowered } = await lowerSource(
      `
import type { Contract } from "${AUTHORING_TYPES}";
import type { Endpoint } from "./vendor/endpoint.js";

export interface UsersContract extends Contract<"Users"> {
  Ping: Endpoint<{ method: "GET"; route: "/api/ping"; response: void }>;
}
`,
      { "vendor/endpoint.ts": "export type Endpoint<TSpec> = { readonly spec?: TSpec };\n" },
    );

    // The source authoring types also declare an `Endpoint` (DUPLICATE_TYPE_NAME); the
    // published package ships them as declarations, which are not indexed.
    expect(lowered.diagnostics).toContainEqual(
      errorDiagnostic({
        code: "FOREIGN_AUTHORING_TYPE",
        filePath: entryPath,
        line: 6,
        message: expect.stringContaining(
          'import Contract and Endpoint from "@maxanstey-meridian/rivet-ts"',
        ),
      }),
    );
  });

  it.each([
    ["a non-literal", "string"],
    ["an empty", '""'],
  ])("reports %s Contract<Name> argument at its location", async (_, name) => {
    const { entryPath, lowered } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface UsersContract extends Contract<${name}> {
  Ping: Endpoint<{ method: "GET"; route: "/api/ping"; response: void }>;
}
`);

    expect(lowered.diagnostics).toContainEqual(
      errorDiagnostic({
        code: "INVALID_CONTRACT_NAME",
        filePath: entryPath,
        line: expect.any(Number),
      }),
    );
    expect(lowered.contracts).toEqual([]);
  });

  it("reports a computed endpoint member name", async () => {
    const { lowered } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

const ping = "Ping";

export interface UsersContract extends Contract<"Users"> {
  [ping]: Endpoint<{ method: "GET"; route: "/api/ping"; response: void }>;
}
`);

    expect(lowered.diagnostics).toEqual([
      errorDiagnostic({
        code: "UNSUPPORTED_ENDPOINT_NAME",
        message:
          "Endpoint names must be an identifier or a string literal; computed and numeric names are not supported.",
      }),
    ]);
  });

  it("reports a numeric endpoint member name", async () => {
    const { lowered } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface UsersContract extends Contract<"Users"> {
  0: Endpoint<{ method: "GET"; route: "/api/ping"; response: void }>;
}
`);

    expect(lowered.diagnostics).toEqual([errorDiagnostic({ code: "UNSUPPORTED_ENDPOINT_NAME" })]);
    expect(lowered.contracts[0]?.endpoints).toEqual([]);
  });

  it("reads an endpoint spec alias declared in another file", async () => {
    const { lowered, document } = await lowerSource(
      `
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";
import type { ListUsersSpec } from "./specs.js";

export interface UsersContract extends Contract<"UsersContract"> {
  List: Endpoint<ListUsersSpec>;
}
`,
      {
        "specs.ts": `
export interface UserDto {
  id: string;
}

export type ListUsersSpec = {
  method: "GET";
  route: "/api/users";
  successStatus: 202;
  response: UserDto[];
};
`,
      },
    );

    expect(lowered.diagnostics).toEqual([]);
    expectValidContractDocument(document);
    expect(document.endpoints[0]?.responses.map((response) => response.statusCode)).toEqual([202]);
  });

  it("rejects a generic endpoint spec alias with a located diagnostic and drops the endpoint", async () => {
    const { entryPath, lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface MemberDto {
  id: string;
}

type CrudSpec<T> = {
  method: "GET";
  route: "/api/members";
  response: T;
};

export interface MembersContract extends Contract<"MembersContract"> {
  List: Endpoint<CrudSpec<MemberDto>>;
}
`);

    expect(lowered.diagnostics).toContainEqual(
      errorDiagnostic({
        code: "UNSUPPORTED_GENERIC_ENDPOINT_SPEC",
        filePath: entryPath,
        line: expect.any(Number),
      }),
    );
    expect(document.endpoints).toEqual([]);
    expect(JSON.stringify(document)).not.toContain('"T"');
  });

  it("reports same-named types from different files instead of merging them", async () => {
    const { entryPath, lowered } = await lowerSource(
      `
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";
import type { Item } from "./warehouse.js";
import type { Item as CatalogItem } from "./catalog.js";

export interface ItemsContract extends Contract<"ItemsContract"> {
  GetWarehouseItem: Endpoint<{ method: "GET"; route: "/api/warehouse-item"; response: Item }>;
  GetCatalogItem: Endpoint<{ method: "GET"; route: "/api/catalog-item"; response: CatalogItem }>;
}
`,
      {
        "warehouse.ts": "export interface Item {\n  sku: string;\n}\n",
        "catalog.ts": "export interface Item {\n  code: number;\n}\n",
      },
    );

    expect(lowered.diagnostics).toContainEqual(
      errorDiagnostic({
        code: "DUPLICATE_TYPE_NAME",
        filePath: expect.stringContaining(path.dirname(entryPath)),
        line: expect.any(Number),
      }),
    );
  });

  it("reports compiler diagnostics for unsupported endpoint metadata keys", () => {
    const { lowered } = lowerFixture("invalid-authoring-contract");

    const compilerDiagnostic = (key: string) =>
      errorDiagnostic({
        code: expect.stringMatching(/^TS\d+$/),
        filePath: fixturePath("invalid-authoring-contract", "contracts.ts"),
        message: expect.stringContaining(key),
      });
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        compilerDiagnostic("topLevelExtra"),
        compilerDiagnostic("securityExtra"),
        compilerDiagnostic("errorExtra"),
      ]),
    );
  });
});

describe("endpoint metadata", () => {
  it("lowers the expressive fixture to its golden contract JSON", async () => {
    const { lowered, document } = lowerFixture("expressive-contract");

    expect(lowered.diagnostics).toEqual([]);
    expectValidContractDocument(document);
    await expect(`${lowered.toJson()}\n`).toMatchFileSnapshot(
      fixturePath("expressive-contract", "golden-contract.json"),
    );
  });

  it("lowers an aliased endpoint spec built from the authoring helper types", () => {
    const { lowered, document } = lowerFixture("aliased-authoring-contract");

    expect(lowered.diagnostics).toEqual([]);
    expect(lowered.contracts.map((contract) => contract.name)).toEqual(["AliasedMembersContract"]);
    expect(document.types).toContainEqual(
      expect.objectContaining({
        name: "MemberDto",
        properties: [
          expect.objectContaining({ name: "id" }),
          expect.objectContaining({ name: "email" }),
        ],
      }),
    );
    const list = endpointNamed(document, "list");
    const memberList = { kind: "array", element: { kind: "ref", name: "MemberDto" } };
    expect(list).toMatchObject({
      httpMethod: "GET",
      routeTemplate: "/api/aliased-members",
      summary: "List aliased members",
      description: "List members from an aliased endpoint spec",
      security: { isAnonymous: false, scheme: "admin" },
      returnType: memberList,
      requestExamples: [example({ search: "Ada" })],
    });
    expect(list.responses).toEqual([
      expect.objectContaining({
        statusCode: 200,
        dataType: memberList,
        examples: [example([{ id: "mem_123", email: "ada@example.com" }])],
      }),
      expect.objectContaining({ statusCode: 404, description: "Members not found" }),
    ]);
    expect(list).not.toHaveProperty("successResponseExample");
  });

  it("reports security that uses the helper shape without a string literal scheme", async () => {
    const { entryPath, lowered } = await lowerSource(`
import type { Contract, Endpoint, EndpointSecurityAuthoringSpec } from "${AUTHORING_TYPES}";

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    response: void;
    security: EndpointSecurityAuthoringSpec;
  }>;
}
`);

    expect(lowered.diagnostics).toContainEqual(
      errorDiagnostic({
        code: "INVALID_SECURITY_SPEC",
        filePath: entryPath,
        message: expect.stringContaining("security.scheme as a string literal"),
      }),
    );
  });

  it("reports contradictory anonymous and security metadata instead of dropping security", async () => {
    const { entryPath, lowered } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface TempContract extends Contract<"TempContract"> {
  Ping: Endpoint<{
    method: "GET";
    route: "/api/ping";
    anonymous: true;
    security: { scheme: "admin" };
  }>;
}
`);

    expect(lowered.diagnostics).toContainEqual(
      errorDiagnostic({
        code: "CONFLICTING_SECURITY_SPEC",
        filePath: entryPath,
        message: expect.stringContaining("cannot declare both anonymous and security"),
      }),
    );
  });

  it("defaults a file response to application/octet-stream when fileContentType is omitted", async () => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface TempContract extends Contract<"TempContract"> {
  Download: Endpoint<{ method: "GET"; route: "/api/download"; fileResponse: true }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    expect(endpointNamed(document, "download")).toMatchObject({
      fileContentType: "application/octet-stream",
      responses: [expect.objectContaining({ statusCode: 200 })],
    });
  });

  it.each([
    ["readonly-array syntax", "readonly ValidationFailure[]"],
    ["Array helper syntax", "Array<ValidationFailure>"],
    ["ReadonlyArray helper syntax", "ReadonlyArray<ValidationFailure>"],
  ])("lowers errors authored via %s", async (_, errorsType) => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint, EndpointErrorAuthoringSpec } from "${AUTHORING_TYPES}";

export interface ValidationErrorDto {
  message: string;
}

type ValidationFailure = EndpointErrorAuthoringSpec & {
  status: 422;
  description: "Validation failed";
  response: ValidationErrorDto;
};

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{ method: "POST"; route: "/api/temp"; response: void; errors: ${errorsType} }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    expect(endpointNamed(document, "create").responses).toEqual([
      expect.objectContaining({ statusCode: 201 }),
      expect.objectContaining({
        statusCode: 422,
        description: "Validation failed",
        dataType: expect.objectContaining({ name: "ValidationErrorDto" }),
      }),
    ]);
  });

  it("reads errors and example lists through type aliases imported from another file", async () => {
    const { lowered, document } = await lowerSource(
      `
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";
import type { ApiErrors, CreateRequestExamples, CreateResponseExamples, CreateRequest, CreatedDto } from "./shared.js";

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    input: CreateRequest;
    requestExamples: CreateRequestExamples;
    response: CreatedDto;
    responseExamples: CreateResponseExamples;
    errors: ApiErrors;
  }>;
}
`,
      {
        "shared.ts": `
export interface CreateRequest { email: string; }
export interface CreatedDto { id: number; }
export interface ValidationErrorDto { message: string; }

export const createRequestExample = { email: "jane@example.com" } satisfies CreateRequest;
export const createdExample = { id: 1 } satisfies CreatedDto;

export type ApiErrors = [{ status: 422; response: ValidationErrorDto }];
export type CreateRequestExamples = [typeof createRequestExample];
export type CreateResponseExamples = [{ status: 201; examples: [typeof createdExample] }];
`,
      },
    );

    expect(lowered.diagnostics).toEqual([]);
    const create = endpointNamed(document, "create");
    expect(create.requestExamples).toEqual([example({ email: "jane@example.com" })]);
    expect(examplesAt(create, 201)).toEqual([example({ id: 1 })]);
    expect(create.responses.map((response) => response.statusCode)).toEqual([201, 422]);
  });

  it.each([
    ["a non-array errors type", "string", "INVALID_ERRORS_SPEC"],
    ["a non-object error entry", "Array<string>", "INVALID_ERROR_ENTRY"],
    [
      "a helper error entry without a literal status",
      "Array<EndpointErrorAuthoringSpec>",
      "MISSING_ERROR_STATUS",
    ],
  ])("reports %s and keeps only the success response", async (_, errorsType, code) => {
    const { entryPath, lowered, document } = await lowerSource(`
import type { Contract, Endpoint, EndpointErrorAuthoringSpec } from "${AUTHORING_TYPES}";

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{ method: "POST"; route: "/api/temp"; response: void; errors: ${errorsType} }>;
}
`);

    expect(lowered.diagnostics).toContainEqual(errorDiagnostic({ code, filePath: entryPath }));
    expect(endpointNamed(document, "create").responses).toEqual([
      expect.objectContaining({ statusCode: 201 }),
    ]);
  });
});

describe("endpoint params", () => {
  it("lowers explicit params: and query: declarations with their sources and optionality", async () => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface ItemDto {
  id: number;
  name: string;
}

export interface ItemsContract extends Contract<"ItemsContract"> {
  Get: Endpoint<{
    method: "GET";
    route: "/api/items/{id}";
    params: { id: number };
    query: { search?: string };
    response: ItemDto;
  }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    expectValidContractDocument(document);
    expect(endpointNamed(document, "get").params).toEqual([
      expect.objectContaining({
        name: "id",
        source: "route",
        isOptional: false,
        type: { kind: "primitive", type: "number" },
      }),
      expect.objectContaining({
        name: "search",
        source: "query",
        isOptional: true,
        type: { kind: "primitive", type: "string" },
      }),
    ]);
  });

  it("adds string route params for placeholders the input type or params: does not declare", async () => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface SearchQuery {
  q: string;
}

export interface PostsContract extends Contract<"PostsContract"> {
  Search: Endpoint<{
    method: "GET";
    route: "/api/users/{id}/posts";
    input: SearchQuery;
    response: void;
  }>;
  Get: Endpoint<{
    method: "GET";
    route: "/api/items/{id}/sub/{subId}";
    params: { id: number };
    response: void;
  }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    expectValidContractDocument(document);
    const string = { kind: "primitive", type: "string" };
    expect(endpointNamed(document, "search").params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", source: "route", type: string }),
        expect.objectContaining({ name: "q", source: "query" }),
      ]),
    );
    expect(endpointNamed(document, "get").params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "id",
          source: "route",
          type: { kind: "primitive", type: "number" },
        }),
        expect.objectContaining({ name: "subId", source: "route", type: string }),
      ]),
    );
  });

  it("reports a non-object explicit query: type at its location instead of dropping it", async () => {
    const { entryPath, lowered } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface UserFilter {
  status: string;
  role: string;
}

export type UserParams = Pick<UserFilter, "status">;

export interface UsersContract extends Contract<"UsersContract"> {
  List: Endpoint<{ method: "GET"; route: "/api/users"; query: UserParams; response: void }>;
}
`);

    expect(lowered.diagnostics).toContainEqual(
      errorDiagnostic({
        code: "UNSUPPORTED_QUERY_SHAPE",
        filePath: entryPath,
        line: expect.any(Number),
      }),
    );
  });
});

describe("request examples", () => {
  it("lowers plural and legacy singular request examples from the fixture as JSON examples", () => {
    const { lowered, document } = lowerFixture("request-examples-contract");

    expect(lowered.diagnostics).toEqual([]);
    expectValidContractDocument(document);
    expect(document.endpoints.map((endpoint) => endpoint.name).sort()).toEqual([
      "create",
      "legacyCreate",
    ]);
    expect(endpointNamed(document, "create").requestExamples).toEqual([
      example({ email: "jane@example.com", role: "admin" }),
      example({ email: "alex@example.com", role: "reviewer" }),
    ]);
    expect(endpointNamed(document, "legacyCreate").requestExamples).toEqual([
      example({ email: "legacy@example.com", role: "member" }),
    ]);
    for (const endpoint of document.endpoints) {
      expect(endpoint).not.toHaveProperty("requestExample");
      // isFormEncoded is on the wire only when true.
      expect(endpoint).not.toHaveProperty("isFormEncoded");
    }
  });

  it.each([
    ["tuple syntax", "[typeof createMemberRequestExample]"],
    ["readonly tuple syntax", "readonly [typeof createMemberRequestExample]"],
    ["Array helper syntax", "Array<typeof createMemberRequestExample>"],
    ["ReadonlyArray helper syntax", "ReadonlyArray<typeof createMemberRequestExample>"],
  ])("lowers requestExamples authored via %s", async (_, requestExamplesType) => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface CreateMemberRequest {
  email: string;
}

export const createMemberRequestExample = { email: "jane@example.com" } satisfies CreateMemberRequest;

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    input: CreateMemberRequest;
    requestExamples: ${requestExamplesType};
    response: void;
  }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    expect(document.endpoints[0]?.requestExamples).toEqual([
      example({ email: "jane@example.com" }),
    ]);
  });

  it("lowers named inline and ref-backed request example descriptors in authored order", async () => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface CreateMemberRequest {
  email: string;
  role: string;
}

export const defaultRequestExample = {
  email: "jane@example.com",
  role: "admin",
} satisfies CreateMemberRequest;

export const namedRequestExample = {
  email: "alex@example.com",
  role: "reviewer",
} satisfies CreateMemberRequest;

export const componentResolvedRequestExample = {
  email: "component@example.com",
  role: "member",
} satisfies CreateMemberRequest;

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    input: CreateMemberRequest;
    response: void;
    requestExamples: [
      typeof defaultRequestExample,
      { name: "plain-text"; mediaType: "text/plain"; json: typeof namedRequestExample },
      {
        name: "component-backed";
        mediaType: "application/json";
        componentExampleId: "CreateMemberExample";
        resolvedJson: typeof componentResolvedRequestExample;
      },
    ];
  }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    expect(endpointNamed(document, "create").requestExamples).toEqual([
      example({ email: "jane@example.com", role: "admin" }),
      {
        name: "plain-text",
        ...example({ email: "alex@example.com", role: "reviewer" }, "text/plain"),
      },
      {
        name: "component-backed",
        mediaType: "application/json",
        componentExampleId: "CreateMemberExample",
        resolvedJson: JSON.stringify({ email: "component@example.com", role: "member" }),
      },
    ]);
  });

  const malformedExampleCases: readonly (readonly [string, string, string])[] = [
    [
      "a descriptor mixing inline and ref-backed fields",
      `
export interface CreateMemberRequest {
  email: string;
}

export const createMemberRequestExample = { email: "jane@example.com" } satisfies CreateMemberRequest;

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    input: CreateMemberRequest;
    response: void;
    requestExamples: [
      {
        json: typeof createMemberRequestExample;
        componentExampleId: "CreateMemberExample";
        resolvedJson: typeof createMemberRequestExample;
      },
    ];
  }>;
}
`,
      "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
    ],
    [
      "a non-typeof example reference",
      `
interface CreateMemberRequest {
  email: string;
}

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    requestExample: CreateMemberRequest;
    response: void;
  }>;
}
`,
      "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
    ],
    [
      "a spread in the const initializer",
      `
interface CreateMemberRequest {
  email: string;
  role: string;
}

const baseRequest = { role: "admin" };
export const createMemberRequestExample = {
  email: "jane@example.com",
  ...baseRequest,
} satisfies CreateMemberRequest;

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    input: CreateMemberRequest;
    requestExample: typeof createMemberRequestExample;
    response: void;
  }>;
}
`,
      "UNSUPPORTED_ENDPOINT_EXAMPLE_VALUE",
    ],
    [
      "a non-exported const reference",
      `
interface CreateMemberRequest {
  email: string;
}

const createMemberRequestExample = { email: "jane@example.com" } satisfies CreateMemberRequest;

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    requestExample: typeof createMemberRequestExample;
    response: void;
  }>;
}
`,
      "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
    ],
    [
      "a request example without a matching input",
      `
interface CreateMemberRequest {
  email: string;
}

export const createMemberRequestExample = { email: "jane@example.com" } satisfies CreateMemberRequest;

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    requestExample: typeof createMemberRequestExample;
    response: void;
  }>;
}
`,
      "INVALID_ENDPOINT_EXAMPLE_TYPE",
    ],
    [
      "a success response example without a matching response",
      `
interface CreateMemberResponse {
  id: string;
}

export const createMemberResponseExample = { id: "mem_123" } satisfies CreateMemberResponse;

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    input: { email: string };
    successResponseExample: typeof createMemberResponseExample;
  }>;
}
`,
      "INVALID_ENDPOINT_EXAMPLE_TYPE",
    ],
    [
      "a non-array container such as Promise<typeof x> as the example list",
      `
export interface CreateRequest {
  email: string;
}

export const example = { email: "jane@example.com" } satisfies CreateRequest;

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    input: CreateRequest;
    requestExamples: Promise<typeof example>;
  }>;
}
`,
      "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
    ],
  ];

  it.each(malformedExampleCases)(
    "reports %s and emits no request examples",
    async (_, body, code) => {
      const { entryPath, lowered, document } = await lowerSource(
        `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";\n${body}`,
      );

      expect(lowered.diagnostics).toContainEqual(errorDiagnostic({ code, filePath: entryPath }));
      expect(endpointNamed(document, "create")).not.toHaveProperty("requestExamples");
    },
  );

  it("reports compiler diagnostics when an example reference resolves to a non-JSON-like value", async () => {
    const { entryPath, lowered } = await lowerSource(`
import type { Contract, Endpoint, EndpointExampleAuthoringReference } from "${AUTHORING_TYPES}";

export const createMemberRequestExample = {
  email: "jane@example.com",
  normalize: () => "jane@example.com",
};

const checkedExample: EndpointExampleAuthoringReference<typeof createMemberRequestExample> =
  createMemberRequestExample;

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    requestExample: typeof createMemberRequestExample;
    response: void;
  }>;
}
`);

    expect(lowered.diagnostics).toContainEqual(
      errorDiagnostic({
        code: expect.stringMatching(/^TS\d+$/),
        filePath: entryPath,
        message: expect.stringContaining("normalize"),
      }),
    );
  });

  const mismatchedExamples = (bypassDsl: boolean) => `
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface CreateMemberRequest {
  email: string;
}

interface MemberDto {
  id: string;
}

export const wrongRequestExample = { id: "mem_123" } satisfies MemberDto;
export const wrongResponseExample = { email: "jane@example.com" } satisfies CreateMemberRequest;

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    input: CreateMemberRequest;
    response: MemberDto;
    ${bypassDsl ? "// @ts-ignore bypass the DSL check to reach the lowerer's own" : ""}
    requestExample: typeof wrongRequestExample;
    ${bypassDsl ? "// @ts-ignore bypass the DSL check to reach the lowerer's own" : ""}
    successResponseExample: typeof wrongResponseExample;
  }>;
}
`;

  it("reports compiler diagnostics when request and response examples do not match the endpoint types", async () => {
    const { entryPath, lowered } = await lowerSource(mismatchedExamples(false));

    const compilerDiagnostic = (key: string) =>
      errorDiagnostic({
        code: expect.stringMatching(/^TS\d+$/),
        filePath: entryPath,
        message: expect.stringContaining(key),
      });
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        compilerDiagnostic("requestExample"),
        compilerDiagnostic("successResponseExample"),
      ]),
    );
  });

  it("rejects mismatched examples in the lowerer when the DSL type check is bypassed", async () => {
    const { entryPath, lowered, document } = await lowerSource(mismatchedExamples(true));

    const typeDiagnostic = (key: string) =>
      errorDiagnostic({
        code: "INVALID_ENDPOINT_EXAMPLE_TYPE",
        filePath: entryPath,
        message: expect.stringContaining(key),
      });
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        typeDiagnostic("requestExample"),
        typeDiagnostic("successResponseExample"),
      ]),
    );
    expect(endpointNamed(document, "create")).not.toHaveProperty("requestExamples");
  });

  it("attributes a malformed imported example to the module that declares its initializer", async () => {
    const { entryPath, lowered } = await lowerSource(
      `
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";
import { createMemberRequestExample } from "./examples.js";

interface CreateMemberRequest {
  email: string;
  role: string;
}

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    input: CreateMemberRequest;
    requestExample: typeof createMemberRequestExample;
    response: void;
  }>;
}
`,
      {
        "examples.ts": `
interface CreateMemberRequest {
  email: string;
  role: string;
}

const baseRequest = { role: "admin" };
export const createMemberRequestExample = {
  email: "jane@example.com",
  ...baseRequest,
} satisfies CreateMemberRequest;
`,
      },
    );

    expect(lowered.diagnostics).toContainEqual(
      errorDiagnostic({
        code: "UNSUPPORTED_ENDPOINT_EXAMPLE_VALUE",
        filePath: path.join(path.dirname(entryPath), "examples.ts"),
      }),
    );
  });

  it("evaluates shorthand properties, const references and string concatenation in example values", async () => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface CreateMemberRequest {
  email: string;
  role: string;
}
export interface ItemDto { name: string; tags: string[]; csv: string; }
export interface ResponseDto { item: ItemDto; total: number; }

const email = "jane@example.com";
export const createMemberRequestExample = { email, role: "admin" } satisfies CreateMemberRequest;

const item = { name: "widget", tags: ["a", "b"], csv: "a,b\\n" + "1,2\\n" };
export const responseExample = { item, total: 1 } satisfies ResponseDto;

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    input: CreateMemberRequest;
    requestExample: typeof createMemberRequestExample;
    response: ResponseDto;
    responseExamples: [{ status: 201; examples: [typeof responseExample] }];
  }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    const create = endpointNamed(document, "create");
    expect(create.requestExamples).toEqual([example({ email: "jane@example.com", role: "admin" })]);
    expect(examplesAt(create, 201)).toEqual([
      example({ item: { name: "widget", tags: ["a", "b"], csv: "a,b\n1,2\n" }, total: 1 }),
    ]);
  });

  it.each([
    [
      "requestExample and requestExamples",
      `input: CreateRequest;
    response: void;
    requestExample: typeof example1;
    requestExamples: [typeof example2];`,
      "CONFLICTING_REQUEST_EXAMPLE_SPEC",
    ],
    [
      "successResponseExample and responseExamples",
      `response: CreateRequest;
    successResponseExample: typeof example1;
    responseExamples: [{ status: 201; examples: [typeof example2] }];`,
      "CONFLICTING_RESPONSE_EXAMPLE_SPEC",
    ],
  ])("reports an endpoint that declares both %s", async (_, examples, code) => {
    const { lowered } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface CreateRequest { email: string; }

export const example1 = { email: "a@example.com" } satisfies CreateRequest;
export const example2 = { email: "b@example.com" } satisfies CreateRequest;

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    ${examples}
  }>;
}
`);

    expect(lowered.diagnostics).toContainEqual(errorDiagnostic({ code }));
  });
});

describe("response examples", () => {
  it("lowers status-scoped and legacy success response examples from the fixture", () => {
    const { lowered, document } = lowerFixture("response-examples-contract");

    expect(lowered.diagnostics).toEqual([]);
    expectValidContractDocument(document);
    expect(document.endpoints.map((endpoint) => endpoint.name).sort()).toEqual([
      "create",
      "legacyCreate",
    ]);
    const create = endpointNamed(document, "create");
    expect(examplesAt(create, 201)).toEqual([
      example({ id: "mem_001", email: "jane@example.com" }),
      example({ id: "mem_002", email: "alex@example.com" }),
    ]);
    expect(examplesAt(create, 422)).toEqual([
      example({ message: "Email is required", code: "VALIDATION_ERROR" }),
    ]);
    expect(examplesAt(endpointNamed(document, "legacyCreate"), 201)).toEqual([
      example({ id: "mem_legacy", email: "legacy@example.com" }),
    ]);
    for (const endpoint of document.endpoints) {
      expect(endpoint).not.toHaveProperty("successResponseExample");
    }
  });

  it("lowers scalar and array-root success examples without wrapping them", async () => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export const tagsExample = ["alpha", "beta"] satisfies string[];
export const versionExample = 3 satisfies number;

export interface TempContract extends Contract<"TempContract"> {
  Tags: Endpoint<{
    method: "GET";
    route: "/api/tags";
    response: string[];
    successResponseExample: typeof tagsExample;
  }>;
  Version: Endpoint<{
    method: "GET";
    route: "/api/version";
    response: number;
    successResponseExample: typeof versionExample;
  }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    expect(examplesAt(endpointNamed(document, "tags"), 200)).toEqual([example(["alpha", "beta"])]);
    expect(examplesAt(endpointNamed(document, "version"), 200)).toEqual([example(3)]);
  });

  it("lowers named and ref-backed response example descriptors with their metadata", async () => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface MemberDto { id: string; email: string; }
export interface ValidationErrorDto { message: string; code: string; }

export const successExample = { id: "mem_1", email: "jane@example.com" } satisfies MemberDto;
export const errorExample = { message: "Bad request", code: "VALIDATION" } satisfies ValidationErrorDto;
export const componentExample = { id: "mem_2", email: "component@example.com" } satisfies MemberDto;

export interface TempContract extends Contract<"TempContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/temp";
    input: MemberDto;
    response: MemberDto;
    successStatus: 201;
    errors: [{ status: 422; response: ValidationErrorDto; description: "Validation failed" }];
    responseExamples: [
      {
        status: 201;
        examples: [
          { name: "default member"; json: typeof successExample },
          {
            name: "component-backed member";
            componentExampleId: "MemberExample";
            resolvedJson: typeof componentExample;
          },
        ];
      },
      {
        status: 422;
        examples: [
          { name: "validation error"; mediaType: "application/problem+json"; json: typeof errorExample },
        ];
      },
    ];
  }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    const create = endpointNamed(document, "create");
    expect(examplesAt(create, 201)).toEqual([
      { name: "default member", ...example({ id: "mem_1", email: "jane@example.com" }) },
      {
        name: "component-backed member",
        mediaType: "application/json",
        componentExampleId: "MemberExample",
        resolvedJson: JSON.stringify({ id: "mem_2", email: "component@example.com" }),
      },
    ]);
    expect(examplesAt(create, 422)).toEqual([
      {
        name: "validation error",
        ...example({ message: "Bad request", code: "VALIDATION" }, "application/problem+json"),
      },
    ]);
  });

  it("defaults file success examples to fileContentType and error examples to application/json", async () => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface ErrorDto { message: string; }

export const fileSuccessExample = { url: "https://example.com/file.csv" } satisfies { url: string };
export const fileErrorExample = { message: "Not found" } satisfies ErrorDto;

export interface TempContract extends Contract<"TempContract"> {
  Export: Endpoint<{
    method: "GET";
    route: "/api/export";
    fileResponse: true;
    fileContentType: "text/csv";
    errors: [{ status: 404; response: ErrorDto; description: "Not found" }];
    responseExamples: [
      { status: 200; examples: [typeof fileSuccessExample] },
      { status: 404; examples: [typeof fileErrorExample] },
    ];
  }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    const exportEndpoint = endpointNamed(document, "export");
    expect(examplesAt(exportEndpoint, 200)).toEqual([
      example({ url: "https://example.com/file.csv" }, "text/csv"),
    ]);
    expect(examplesAt(exportEndpoint, 404)).toEqual([example({ message: "Not found" })]);
  });

  // The DSL does not constrain status-scoped examples at the type level and C#
  // Rivet carries example JSON verbatim, so the lowerer does not invent a check.
  it("lowers status-scoped response examples without checking them against the response type", async () => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface MemberDto { id: string; }
export const example = { other: 1 };

export interface TempContract extends Contract<"TempContract"> {
  Get: Endpoint<{
    method: "GET";
    route: "/api/temp";
    response: MemberDto;
    responseExamples: [{ status: 200; examples: [typeof example] }];
  }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    expect(document.endpoints[0]?.responses[0]?.examples).toEqual([example({ other: 1 })]);
  });

  it("reports response examples for a status the endpoint does not declare", async () => {
    const { lowered } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface MemberDto { id: string; }
export const example1 = { id: "mem_1" } satisfies MemberDto;

export interface TempContract extends Contract<"TempContract"> {
  Get: Endpoint<{
    method: "GET";
    route: "/api/temp";
    response: MemberDto;
    responseExamples: [{ status: 404; examples: [typeof example1] }];
  }>;
}
`);

    expect(lowered.diagnostics).toContainEqual(
      errorDiagnostic({
        code: "UNRESOLVED_RESPONSE_EXAMPLE_STATUS",
        message: expect.stringContaining("status 404"),
      }),
    );
  });

  it("names the responseExamples entry, not requestExamples, when a response descriptor is malformed", async () => {
    const { lowered } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface MemberDto { id: string; }
export const example = { id: "mem_1" } satisfies MemberDto;

export interface TempContract extends Contract<"TempContract"> {
  Get: Endpoint<{
    method: "GET";
    route: "/api/temp";
    response: MemberDto;
    responseExamples: [{ status: 200; examples: [{ name: 42; json: typeof example }] }];
  }>;
}
`);

    expect(lowered.diagnostics).toContainEqual(
      errorDiagnostic({
        code: "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
        message:
          'Endpoint "Get" responseExamples[200].examples entries must declare name as a string literal when provided.',
      }),
    );
  });

  it.each([101, 204, 205, 304])(
    "refuses response examples on body-forbidden status %i, as C# Rivet does (RIV1102)",
    async (status) => {
      const { entryPath, lowered } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export const confirmation = { deleted: true } satisfies { deleted: boolean };

export interface TempContract extends Contract<"TempContract"> {
  Remove: Endpoint<{
    method: "DELETE";
    route: "/api/temp/{id}";
    response: void;
    successStatus: ${status};
    responseExamples: [{ status: ${status}; examples: [typeof confirmation] }];
  }>;
}
`);

      expect(lowered.diagnostics).toEqual([
        errorDiagnostic({
          code: "BODY_FORBIDDEN_STATUS_EXAMPLE",
          filePath: entryPath,
          message: `Endpoint "TempContract.Remove" authors response content on body-forbidden status ${status} — HTTP forbids a message body on 1xx/204/205/304, so the authored example/content could never reach the wire; move it to a status that allows a body or remove it.`,
        }),
      ]);
    },
  );
});

describe("type lowering", () => {
  // C# Rivet reads the explicit optional flag (nullable no longer implies
  // optional there), so the spellings must stay distinct on the wire.
  it("keeps x?: T, x: T | null and x?: T | null distinct in contract JSON", async () => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface ProfileDto {
  optional?: string;
  nullable: string | null;
  optionalNullable?: string | null;
  undefinedUnion: string | undefined;
  inline: { optional?: string; nullable: string | null; optionalNullable?: string | null };
}

export interface ProfilesContract extends Contract<"Profiles"> {
  Get: Endpoint<{ method: "GET"; route: "/api/profile"; response: ProfileDto }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    const string = { kind: "primitive", type: "string" };
    const nullableString = { kind: "nullable", inner: string };
    expect(document.types[0]?.properties).toEqual([
      { name: "optional", type: string, optional: true },
      { name: "nullable", type: nullableString, optional: false },
      { name: "optionalNullable", type: nullableString, optional: true },
      { name: "undefinedUnion", type: string, optional: true },
      {
        name: "inline",
        optional: false,
        type: {
          kind: "inlineObject",
          properties: [
            { name: "optional", type: string, optional: true },
            { name: "nullable", type: nullableString, optional: false },
            { name: "optionalNullable", type: nullableString, optional: true },
          ],
        },
      },
    ]);
  });

  it.each([
    ["Date", { kind: "primitive", type: "string", format: "date-time" }],
    [
      "number | false",
      {
        kind: "union",
        variants: [
          { kind: "primitive", type: "number" },
          { kind: "literal", value: false },
        ],
      },
    ],
    ["-1 | 1", { kind: "intUnion", values: [-1, 1] }],
    [
      '{ kind: "dog"; bark: boolean } | { kind: "cat"; meow: boolean } | null',
      {
        kind: "nullable",
        inner: expect.objectContaining({
          kind: "taggedUnion",
          discriminator: "kind",
          variants: [
            expect.objectContaining({ tag: "dog" }),
            expect.objectContaining({ tag: "cat" }),
          ],
        }),
      },
    ],
  ])("lowers a %s property", async (tsType, expected) => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface ValueDto {
  value: ${tsType};
}

export interface ValuesContract extends Contract<"Values"> {
  Get: Endpoint<{ method: "GET"; route: "/api/value"; response: ValueDto }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    expectValidContractDocument(document);
    expect(document.types[0]?.properties).toEqual([
      { name: "value", type: expected, optional: false },
    ]);
  });

  it("flattens inherited interface properties into the lowered DTO", async () => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface BaseDto {
  id: string;
  createdAt: string;
}

export interface UserDto extends BaseDto {
  email: string;
}

export interface UsersContract extends Contract<"UsersContract"> {
  Get: Endpoint<{ method: "GET"; route: "/api/users"; response: UserDto }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    expectValidContractDocument(document);
    const userDto = document.types.find((type) => type.name === "UserDto");
    expect(userDto?.properties?.map((property) => property.name).sort()).toEqual([
      "createdAt",
      "email",
      "id",
    ]);
  });

  it("lowers enum member values the compiler computes: auto-numbered, negative and shifted", async () => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export enum Role { Admin, User }
export enum Offset { Behind = -1, Zero, Ahead }
export enum Permission { Read = 1, Write = 1 << 1, Delete = 1 << 2 }

export interface MemberDto {
  role: Role;
  offset: Offset;
  permission: Permission;
}

export interface MembersContract extends Contract<"MembersContract"> {
  Get: Endpoint<{ method: "GET"; route: "/api/member"; response: MemberDto }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    expectValidContractDocument(document);
    expect(document.enums).toEqual([
      { name: "Offset", intValues: [-1, 0, 1] },
      { name: "Permission", intValues: [1, 2, 4] },
      { name: "Role", intValues: [0, 1] },
    ]);
  });

  it("numbers the uninitialised members of an ambient enum as the compiler does", async () => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export declare enum Amb { X, Y }
export declare enum Shifted { X = 5, Y }

export interface MemberDto {
  amb: Amb;
  shifted: Shifted;
}

export interface MembersContract extends Contract<"MembersContract"> {
  Get: Endpoint<{ method: "GET"; route: "/api/member"; response: MemberDto }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    expect(document.enums).toEqual([
      { name: "Amb", intValues: [0, 1] },
      { name: "Shifted", intValues: [5, 6] },
    ]);
  });

  it.each([
    ["Infinity", "1 / 0"],
    ["NaN", "0 / 0"],
  ])("rejects an enum member whose value is %s", async (_, initializer) => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export enum Ratio { A = ${initializer} }

export interface RatioDto { ratio: Ratio; }

export interface RatiosContract extends Contract<"RatiosContract"> {
  Get: Endpoint<{ method: "GET"; route: "/api/ratio"; response: RatioDto }>;
}
`);

    expect(lowered.diagnostics).toContainEqual(
      errorDiagnostic({ code: "UNSUPPORTED_ENUM_MEMBER" }),
    );
    expect(document.enums).toEqual([]);
  });

  it("reports a standalone null type with the nullable-union hint", async () => {
    const { lowered } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface GoneDto { value: null; }

export interface GoneContract extends Contract<"Gone"> {
  Get: Endpoint<{ method: "GET"; route: "/api/gone"; response: GoneDto }>;
}
`);

    expect(lowered.diagnostics).toEqual([
      errorDiagnostic({
        code: "UNSUPPORTED_NULL_TYPE",
        message: "Standalone null types are not supported. Use a nullable union such as T | null.",
      }),
    ]);
  });

  it("lowers discriminated object unions into tagged union contract types", () => {
    const { lowered, document } = lowerFixture("tagged-union-contract");

    expect(lowered.diagnostics).toEqual([]);
    const variant = (tag: string, property: string) =>
      expect.objectContaining({
        tag,
        type: expect.objectContaining({
          kind: "inlineObject",
          properties: expect.arrayContaining([
            expect.objectContaining({ name: property }),
            expect.objectContaining({ name: "workspaceKey" }),
          ]),
        }),
      });
    expect(document.types.find((type) => type.name === "DisplayStateContract")?.type).toEqual(
      expect.objectContaining({
        kind: "taggedUnion",
        discriminator: "kind",
        variants: expect.arrayContaining([
          variant("hidden", "kind"),
          variant("loading", "requestId"),
          variant("shown", "summary"),
        ]),
      }),
    );
    expect(endpointNamed(document, "refresh").responses).toContainEqual(
      expect.objectContaining({
        statusCode: 201,
        dataType: { kind: "ref", name: "DisplayStateContract" },
      }),
    );
  });

  it("reports unsupported discriminated union shapes and keeps the valid one", () => {
    const { lowered, document } = lowerFixture("invalid-tagged-union-contract");

    const modelsPath = fixturePath("invalid-tagged-union-contract", "models.ts");
    const unsupportedUnion = (message: string, line: number) =>
      errorDiagnostic({
        code: "UNSUPPORTED_UNION",
        message,
        filePath: modelsPath,
        line,
      });
    expect(lowered.diagnostics).toEqual([
      // DifferentDiscriminatorState: members disagree on the discriminator.
      unsupportedUnion(
        'Union "| { kind: "hidden"; workspaceKey: string | null }\n' +
          '  | { state: "shown"; summary: string }" is not supported.',
        2,
      ),
      // DuplicateTagState: reported at the repeated literal, then as a whole.
      unsupportedUnion(
        'Union "| { kind: "hidden"; workspaceKey: string | null }\n' +
          '  | { kind: "hidden"; summary: string }" repeats discriminator value "hidden".',
        7,
      ),
      unsupportedUnion(
        'Union "| { kind: "hidden"; workspaceKey: string | null }\n' +
          '  | { kind: "hidden"; summary: string }" is not supported.',
        6,
      ),
      // MixedMemberState: object and literal members cannot be mixed.
      unsupportedUnion(
        'Union "{ kind: "hidden"; workspaceKey: string | null } | "shown"" is not supported.',
        13,
      ),
    ]);

    expect(document.endpoints.map((endpoint) => endpoint.responses[0]?.dataType)).toEqual([
      { kind: "ref", name: "DifferentDiscriminatorState" },
      { kind: "ref", name: "DuplicateTagState" },
      { kind: "ref", name: "OptionalVariantFieldState" },
      { kind: "ref", name: "MixedMemberState" },
    ]);
    // A variant with an optional non-discriminator property is still a tagged union.
    expect(document.types).toEqual([
      expect.objectContaining({
        name: "OptionalVariantFieldState",
        type: expect.objectContaining({
          kind: "taggedUnion",
          variants: expect.arrayContaining([
            expect.objectContaining({
              tag: "loading",
              type: expect.objectContaining({
                properties: expect.arrayContaining([
                  expect.objectContaining({ name: "kind" }),
                  expect.objectContaining({ name: "requestId", optional: true }),
                ]),
              }),
            }),
          ]),
        }),
      }),
    ]);
    expect(document.enums).toEqual([]);
  });

  it("reports unsupported type expressions at their location and drops them", () => {
    const { lowered, document } = lowerFixture("unsupported-contract");

    const modelsPath = fixturePath("unsupported-contract", "models.ts");
    const unsupported = (expression: string, line: number) =>
      errorDiagnostic({
        code: "UNSUPPORTED_TYPE_EXPRESSION",
        message: `Unsupported type expression "${expression}".`,
        filePath: modelsPath,
        line,
      });
    expect(lowered.diagnostics).toEqual([
      unsupported("TValue extends string ? { value: TValue } : never", 1),
      unsupported('string & { readonly __tag: "Value" }', 15),
      unsupported("{\n  [TKey in keyof TValue]: string;\n}", 3),
    ]);

    expect(document.endpoints.map((endpoint) => endpoint.name)).toEqual([
      "search",
      "details",
      "intersect",
    ]);
    expect(document.endpoints[0]?.responses[0]?.dataType).toEqual({
      kind: "generic",
      name: "ConditionalDto",
      typeArgs: [{ kind: "primitive", type: "string" }],
    });
    // An inline optional property survives with explicit optionality.
    expect(document.types).toEqual([
      expect.objectContaining({
        name: "InlineOptionalWrapper",
        properties: [
          expect.objectContaining({
            name: "nested",
            type: {
              kind: "inlineObject",
              properties: [
                expect.objectContaining({ name: "required" }),
                expect.objectContaining({ name: "optional", optional: true }),
              ],
            },
          }),
        ],
      }),
    ]);
    expect(document.enums).toEqual([]);
  });
});

describe("form and multipart endpoints", () => {
  it("lowers a form-encoded endpoint with form-urlencoded request examples", () => {
    const { lowered, document } = lowerFixture("form-encoded-contract");

    expect(lowered.diagnostics).toEqual([]);
    expectValidContractDocument(document);
    expect(document.endpoints).toEqual([
      expect.objectContaining({
        name: "submitForm",
        httpMethod: "POST",
        routeTemplate: "/api/forms",
        isFormEncoded: true,
        params: [expect.objectContaining({ name: "body", source: "body" })],
        requestExamples: [
          example(
            { name: "Jane Doe", email: "jane@example.com", message: "Hello, world!" },
            "application/x-www-form-urlencoded",
          ),
        ],
      }),
    ]);
  });

  it("lowers a multipart endpoint with route, file and form-field params in order", () => {
    const { lowered, document } = lowerFixture("multipart-contract");

    expect(lowered.diagnostics).toEqual([]);
    expectValidContractDocument(document);
    expect(document.endpoints).toHaveLength(1);
    const upload = endpointNamed(document, "uploadDocument");
    expect(upload.inputTypeName).toBe("UploadDocumentRequest");
    expect(upload.params).toEqual([
      expect.objectContaining({ name: "documentId", source: "route", isOptional: false }),
      expect.objectContaining({
        name: "file",
        source: "file",
        isOptional: false,
        type: { kind: "primitive", type: "File" },
      }),
      expect.objectContaining({ name: "title", source: "formField", isOptional: false }),
      expect.objectContaining({ name: "description", source: "formField", isOptional: false }),
    ]);
  });

  it("defaults request example media type to multipart/form-data for acceptsFile endpoints", async () => {
    const { lowered, document } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface UploadRequest {
  // Optional so the JSON request example (which cannot carry a Blob) stays assignable.
  file?: Blob;
  label: string;
}

export const uploadExample = { label: "test" };

export interface TempContract extends Contract<"TempContract"> {
  Upload: Endpoint<{
    method: "POST";
    route: "/api/upload";
    input: UploadRequest;
    response: void;
    acceptsFile: true;
    requestExamples: [typeof uploadExample];
  }>;
}
`);

    expect(lowered.diagnostics).toEqual([]);
    const upload = endpointNamed(document, "upload");
    expect(upload.params).toEqual([
      expect.objectContaining({ name: "file", source: "file" }),
      expect.objectContaining({ name: "label", source: "formField" }),
    ]);
    expect(upload.requestExamples).toEqual([example({ label: "test" }, "multipart/form-data")]);
  });

  it.each([
    ["no file-typed property", "title: string;\n  description: string;", ""],
    ["several file-typed properties", "primary: Blob;\n  secondary: File;\n  title: string;", ""],
    ["explicit query:", "file: Blob;\n  label: string;", "query: { overwrite?: boolean };"],
  ])("reports an acceptsFile endpoint with %s at its location", async (_, members, extra) => {
    const { entryPath, lowered } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface UploadRequest {
  ${members}
}

export interface TempContract extends Contract<"TempContract"> {
  Upload: Endpoint<{
    method: "POST";
    route: "/api/upload";
    input: UploadRequest;
    response: void;
    acceptsFile: true;
    ${extra}
  }>;
}
`);

    expect(lowered.diagnostics).toContainEqual(
      errorDiagnostic({
        code: "INVALID_MULTIPART_INPUT",
        filePath: entryPath,
        line: expect.any(Number),
      }),
    );
  });
});
