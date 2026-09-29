import { lowerContracts } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { expectValidContractDocument } from "../contract-schema.js";
import { writeContractProject } from "../support/contract-project.js";
import { parseContractJson } from "../support/lower.js";
import { AUTHORING_TYPES, fixturePath } from "../support/paths.js";

describe("lowerContracts lifecycle", () => {
  it("lowers an extracted contract bundle into Rivet contract JSON", async () => {
    const lowered = lowerContracts(fixturePath("members-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);

    const payload = parseContractJson(lowered.toJson());

    expectValidContractDocument(payload);

    expect(payload.endpoints).toHaveLength(5);
    expect(payload.types.map((type) => type.name).sort()).toEqual([
      "InviteMemberRequest",
      "InviteMemberResponse",
      "MemberDto",
      "NotFoundDto",
      "PagedResult",
      "UpdateRoleRequest",
      "ValidationErrorDto",
    ]);

    const byName = new Map(payload.endpoints.map((endpoint) => [endpoint.name, endpoint]));
    expect(byName.get("list")).toMatchObject({
      httpMethod: "GET",
      routeTemplate: "/api/members",
      controllerName: "members",
      params: [],
    });
    expect(byName.get("list")?.responses.map((response) => response.statusCode)).toEqual([200]);

    expect(byName.get("invite")).toMatchObject({
      httpMethod: "POST",
      routeTemplate: "/api/members",
      controllerName: "members",
      params: [expect.objectContaining({ name: "body", source: "body", isOptional: false })],
    });
    expect(byName.get("invite")?.responses.map((response) => response.statusCode)).toEqual([
      201, 422,
    ]);

    expect(byName.get("remove")).toMatchObject({
      httpMethod: "DELETE",
      routeTemplate: "/api/members/{id}",
      params: [expect.objectContaining({ name: "id", source: "route", isOptional: false })],
    });
    expect(byName.get("remove")?.responses.map((response) => response.statusCode)).toEqual([
      204, 404,
    ]);

    expect(byName.get("updateRole")).toMatchObject({
      httpMethod: "PUT",
      routeTemplate: "/api/members/{id}/role",
    });
    expect(byName.get("updateRole")?.responses.map((response) => response.statusCode)).toEqual([
      204, 404,
    ]);

    expect(byName.get("health")).toMatchObject({
      httpMethod: "GET",
      routeTemplate: "/api/health",
    });
  });

  it("lowers aliased endpoint-spec examples into Rivet contract JSON", async () => {
    const lowered = lowerContracts(fixturePath("aliased-authoring-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(false);

    const payload = parseContractJson(lowered.toJson());

    const list = payload.endpoints.find((endpoint) => endpoint.name === "list");
    expect(list).toMatchObject({
      requestExamples: [
        {
          json: JSON.stringify({
            search: "Ada",
          }),
          mediaType: "application/json",
        },
      ],
    });
    const successResponse = list?.responses.find((response) => response.statusCode === 200);
    expect(successResponse?.examples).toEqual([
      {
        mediaType: "application/json",
        json: JSON.stringify([
          {
            id: "mem_123",
            email: "ada@example.com",
          },
        ]),
      },
    ]);
    expect(list).not.toHaveProperty("successResponseExample");
  });

  it("lowers plural inline request examples from the dedicated fixture", async () => {
    const lowered = lowerContracts(fixturePath("request-examples-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(false);

    const payload = parseContractJson(lowered.toJson());
    expectValidContractDocument(payload);

    expect(payload.endpoints.map((endpoint) => endpoint.name).sort()).toEqual([
      "create",
      "legacyCreate",
    ]);

    expect(payload.endpoints.find((endpoint) => endpoint.name === "create")).toMatchObject({
      requestExamples: [
        {
          json: JSON.stringify({
            email: "jane@example.com",
            role: "admin",
          }),
          mediaType: "application/json",
        },
        {
          json: JSON.stringify({
            email: "alex@example.com",
            role: "reviewer",
          }),
          mediaType: "application/json",
        },
      ],
    });
    expect(payload.endpoints.find((endpoint) => endpoint.name === "legacyCreate")).toMatchObject({
      requestExamples: [
        {
          json: JSON.stringify({
            email: "legacy@example.com",
            role: "member",
          }),
          mediaType: "application/json",
        },
      ],
    });
    expect(payload.endpoints.every((endpoint) => !("requestExample" in endpoint))).toBe(true);
  });

  it("lowers named inline and ref-backed request example descriptors without reordering or reshaping them", async () => {
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";`,
          "",
          "export interface CreateMemberRequest {",
          "  email: string;",
          "  role: string;",
          "}",
          "",
          "export const defaultRequestExample = {",
          '  email: "jane@example.com",',
          '  role: "admin",',
          "} satisfies CreateMemberRequest;",
          "",
          "export const namedRequestExample = {",
          '  email: "alex@example.com",',
          '  role: "reviewer",',
          "} satisfies CreateMemberRequest;",
          "",
          "export const componentResolvedRequestExample = {",
          '  email: "component@example.com",',
          '  role: "member",',
          "} satisfies CreateMemberRequest;",
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Create: Endpoint<{",
          '    method: "POST";',
          '    route: "/api/temp";',
          "    input: CreateMemberRequest;",
          "    response: void;",
          "    requestExamples: [",
          "      typeof defaultRequestExample,",
          '      { name: "plain-text"; mediaType: "text/plain"; json: typeof namedRequestExample },',
          "      {",
          '        name: "component-backed";',
          '        mediaType: "application/json";',
          '        componentExampleId: "CreateMemberExample";',
          "        resolvedJson: typeof componentResolvedRequestExample;",
          "      },",
          "    ];",
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-request-examples-v2-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(false);

    const payload = parseContractJson(lowered.toJson());

    expect(
      payload.endpoints.find((endpoint) => endpoint.name === "create")?.requestExamples,
    ).toEqual([
      {
        json: JSON.stringify({
          email: "jane@example.com",
          role: "admin",
        }),
        mediaType: "application/json",
      },
      {
        name: "plain-text",
        mediaType: "text/plain",
        json: JSON.stringify({
          email: "alex@example.com",
          role: "reviewer",
        }),
      },
      {
        name: "component-backed",
        mediaType: "application/json",
        componentExampleId: "CreateMemberExample",
        resolvedJson: JSON.stringify({
          email: "component@example.com",
          role: "member",
        }),
      },
    ]);
  });

  it("reports request example descriptors that mix inline and ref-backed fields", async () => {
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";`,
          "",
          "export interface CreateMemberRequest {",
          "  email: string;",
          "}",
          "",
          "export const createMemberRequestExample = {",
          '  email: "jane@example.com",',
          "} satisfies CreateMemberRequest;",
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Create: Endpoint<{",
          '    method: "POST";',
          '    route: "/api/temp";',
          "    input: CreateMemberRequest;",
          "    response: void;",
          "    requestExamples: [",
          "      {",
          "        json: typeof createMemberRequestExample;",
          '        componentExampleId: "CreateMemberExample";',
          "        resolvedJson: typeof createMemberRequestExample;",
          "      },",
          "    ];",
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-invalid-request-example-descriptor-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          filePath: entryPath,
        }),
      ]),
    );

    const payload = parseContractJson(lowered.toJson());
    expect(payload.endpoints.find((endpoint) => endpoint.name === "create")).not.toHaveProperty(
      "requestExamples",
    );
  });

  it.each([
    ["readonly-array syntax", "readonly ValidationFailure[]"],
    ["Array helper syntax", "Array<ValidationFailure>"],
    ["ReadonlyArray helper syntax", "ReadonlyArray<ValidationFailure>"],
  ])("lowers array-authored endpoint errors from the public DSL via %s", async (_, errorsType) => {
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint, EndpointErrorAuthoringSpec } from "${AUTHORING_TYPES}";`,
          "",
          "export interface ValidationErrorDto {",
          "  message: string;",
          "}",
          "",
          "type ValidationFailure = EndpointErrorAuthoringSpec & {",
          "  status: 422;",
          '  description: "Validation failed";',
          "  response: ValidationErrorDto;",
          "};",
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Create: Endpoint<{",
          '    method: "POST";',
          '    route: "/api/temp";',
          "    response: void;",
          `    errors: ${errorsType};`,
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-lower-errors-array-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);

    const payload = parseContractJson(lowered.toJson());
    const createEndpoint = payload.endpoints.find((endpoint) => endpoint.name === "create");

    expect(createEndpoint?.responses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ statusCode: 201 }),
        expect.objectContaining({
          statusCode: 422,
          description: "Validation failed",
          dataType: expect.objectContaining({
            name: "ValidationErrorDto",
          }),
        }),
      ]),
    );
  });

  it("preserves frontend example diagnostics when lowering an invalid bundle", async () => {
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";`,
          "",
          "interface CreateMemberRequest {",
          "  email: string;",
          "  role: string;",
          "}",
          "",
          'const baseRequest = { role: "admin" };',
          "export const createMemberRequestExample = {",
          '  email: "jane@example.com",',
          "  ...baseRequest,",
          "} satisfies CreateMemberRequest;",
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Create: Endpoint<{",
          '    method: "POST";',
          '    route: "/api/temp";',
          "    input: CreateMemberRequest;",
          "    requestExample: typeof createMemberRequestExample;",
          "    response: void;",
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-lower-invalid-example-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_ENDPOINT_EXAMPLE_VALUE",
          filePath: entryPath,
        }),
      ]),
    );

    const payload = parseContractJson(lowered.toJson());
    expect(payload.endpoints.find((endpoint) => endpoint.name === "create")).not.toHaveProperty(
      "requestExamples",
    );
  });

  it("lowers scalar and array-root endpoint examples without wrapping or reshaping them", async () => {
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";`,
          "",
          "export const tagsExample = [",
          '  "alpha",',
          '  "beta",',
          "] satisfies string[];",
          "",
          "export const versionExample = 3 satisfies number;",
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Tags: Endpoint<{",
          '    method: "GET";',
          '    route: "/api/tags";',
          "    response: string[];",
          "    successResponseExample: typeof tagsExample;",
          "  }>;",
          "",
          "  Version: Endpoint<{",
          '    method: "GET";',
          '    route: "/api/version";',
          "    response: number;",
          "    successResponseExample: typeof versionExample;",
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-root-examples-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(false);

    const payload = parseContractJson(lowered.toJson());

    const tags = payload.endpoints.find((endpoint) => endpoint.name === "tags");
    expect(tags?.responses.find((r) => r.statusCode === 200)?.examples).toEqual([
      { mediaType: "application/json", json: JSON.stringify(["alpha", "beta"]) },
    ]);
    const version = payload.endpoints.find((endpoint) => endpoint.name === "version");
    expect(version?.responses.find((r) => r.statusCode === 200)?.examples).toEqual([
      { mediaType: "application/json", json: JSON.stringify(3) },
    ]);
    expect(tags).not.toHaveProperty("successResponseExample");
    expect(version).not.toHaveProperty("successResponseExample");
  });

  it("lowers shorthand-property endpoint examples through the full bundle pipeline", async () => {
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";`,
          "",
          "export interface CreateMemberRequest {",
          "  email: string;",
          "  role: string;",
          "}",
          "",
          'const email = "jane@example.com";',
          "export const createMemberRequestExample = {",
          "  email,",
          '  role: "admin",',
          "} satisfies CreateMemberRequest;",
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Create: Endpoint<{",
          '    method: "POST";',
          '    route: "/api/temp";',
          "    input: CreateMemberRequest;",
          "    requestExample: typeof createMemberRequestExample;",
          "    response: void;",
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-shorthand-example-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(false);

    const payload = parseContractJson(lowered.toJson());

    expect(
      payload.endpoints.find((endpoint) => endpoint.name === "create")?.requestExamples,
    ).toEqual([
      {
        json: JSON.stringify({
          email: "jane@example.com",
          role: "admin",
        }),
        mediaType: "application/json",
      },
    ]);
  });

  it("defaults file responses to application/octet-stream when fileContentType is omitted", async () => {
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";`,
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Download: Endpoint<{",
          '    method: "GET";',
          '    route: "/api/download";',
          "    fileResponse: true;",
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-file-response-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);

    const payload = parseContractJson(lowered.toJson());
    const downloadEndpoint = payload.endpoints.find((endpoint) => endpoint.name === "download");

    expect(downloadEndpoint).toMatchObject({
      fileContentType: "application/octet-stream",
    });
    expect(downloadEndpoint?.responses).toEqual(
      expect.arrayContaining([expect.objectContaining({ statusCode: 200 })]),
    );
  });

  it("reports contradictory anonymous and security metadata instead of silently dropping security", async () => {
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";`,
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Ping: Endpoint<{",
          '    method: "GET";',
          '    route: "/api/ping";',
          "    anonymous: true;",
          '    security: { scheme: "admin" };',
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-conflicting-security-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONFLICTING_SECURITY_SPEC",
          filePath: entryPath,
          message: expect.stringContaining("cannot declare both anonymous and security"),
        }),
      ]),
    );
  });

  it("lowers status-scoped response examples from the dedicated fixture", async () => {
    const lowered = lowerContracts(fixturePath("response-examples-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(false);

    const payload = parseContractJson(lowered.toJson());
    expectValidContractDocument(payload);

    expect(payload.endpoints.map((endpoint) => endpoint.name).sort()).toEqual([
      "create",
      "legacyCreate",
    ]);

    const create = payload.endpoints.find((endpoint) => endpoint.name === "create");
    const successResponse = create?.responses.find((response) => response.statusCode === 201);
    expect(successResponse?.examples).toEqual([
      {
        mediaType: "application/json",
        json: JSON.stringify({ id: "mem_001", email: "jane@example.com" }),
      },
      {
        mediaType: "application/json",
        json: JSON.stringify({ id: "mem_002", email: "alex@example.com" }),
      },
    ]);
    const errorResponse = create?.responses.find((response) => response.statusCode === 422);
    expect(errorResponse?.examples).toEqual([
      {
        mediaType: "application/json",
        json: JSON.stringify({ message: "Email is required", code: "VALIDATION_ERROR" }),
      },
    ]);

    const legacy = payload.endpoints.find((endpoint) => endpoint.name === "legacyCreate");
    const legacySuccessResponse = legacy?.responses.find((response) => response.statusCode === 201);
    expect(legacySuccessResponse?.examples).toEqual([
      {
        mediaType: "application/json",
        json: JSON.stringify({ id: "mem_legacy", email: "legacy@example.com" }),
      },
    ]);

    expect(payload.endpoints.every((endpoint) => !("successResponseExample" in endpoint))).toBe(
      true,
    );
  });

  it("emits a diagnostic when response examples target an undeclared status", async () => {
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";`,
          "",
          "export interface MemberDto { id: string; }",
          "",
          'export const example1 = { id: "mem_1" } satisfies MemberDto;',
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Get: Endpoint<{",
          '    method: "GET";',
          '    route: "/api/temp";',
          "    response: MemberDto;",
          "    responseExamples: [{ status: 404; examples: [typeof example1] }];",
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-unresolved-response-status-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNRESOLVED_RESPONSE_EXAMPLE_STATUS",
          message: expect.stringContaining("status 404"),
        }),
      ]),
    );
  });

  it("lowers named and ref-backed response example descriptors with metadata preserved", async () => {
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";`,
          "",
          "export interface MemberDto { id: string; email: string; }",
          "export interface ValidationErrorDto { message: string; code: string; }",
          "",
          'export const successExample = { id: "mem_1", email: "jane@example.com" } satisfies MemberDto;',
          'export const errorExample = { message: "Bad request", code: "VALIDATION" } satisfies ValidationErrorDto;',
          'export const componentExample = { id: "mem_2", email: "component@example.com" } satisfies MemberDto;',
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Create: Endpoint<{",
          '    method: "POST";',
          '    route: "/api/temp";',
          "    input: MemberDto;",
          "    response: MemberDto;",
          "    successStatus: 201;",
          '    errors: [{ status: 422; response: ValidationErrorDto; description: "Validation failed" }];',
          "    responseExamples: [",
          "      {",
          "        status: 201;",
          "        examples: [",
          '          { name: "default member"; json: typeof successExample },',
          "          {",
          '            name: "component-backed member";',
          '            componentExampleId: "MemberExample";',
          "            resolvedJson: typeof componentExample;",
          "          },",
          "        ];",
          "      },",
          "      {",
          "        status: 422;",
          "        examples: [",
          '          { name: "validation error"; mediaType: "application/problem+json"; json: typeof errorExample },',
          "        ];",
          "      },",
          "    ];",
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-response-example-descriptors-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(false);

    const payload = parseContractJson(lowered.toJson());

    const create = payload.endpoints.find((endpoint) => endpoint.name === "create");
    const successResponse = create?.responses.find((r) => r.statusCode === 201);
    expect(successResponse?.examples).toEqual([
      {
        name: "default member",
        mediaType: "application/json",
        json: JSON.stringify({ id: "mem_1", email: "jane@example.com" }),
      },
      {
        name: "component-backed member",
        mediaType: "application/json",
        componentExampleId: "MemberExample",
        resolvedJson: JSON.stringify({ id: "mem_2", email: "component@example.com" }),
      },
    ]);
    const errorResponse = create?.responses.find((r) => r.statusCode === 422);
    expect(errorResponse?.examples).toEqual([
      {
        name: "validation error",
        mediaType: "application/problem+json",
        json: JSON.stringify({ message: "Bad request", code: "VALIDATION" }),
      },
    ]);
  });

  it("lowers DELETE 204 void response examples without requiring a dataType", async () => {
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";`,
          "",
          "export const deleteConfirmation = { deleted: true } satisfies { deleted: boolean };",
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Remove: Endpoint<{",
          '    method: "DELETE";',
          '    route: "/api/temp/{id}";',
          "    response: void;",
          "    responseExamples: [",
          "      { status: 204; examples: [typeof deleteConfirmation] },",
          "    ];",
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-response-example-void-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(false);

    const payload = parseContractJson(lowered.toJson());

    const remove = payload.endpoints.find((endpoint) => endpoint.name === "remove");
    const voidResponse = remove?.responses.find((r) => r.statusCode === 204);
    expect(voidResponse?.dataType).toBeUndefined();
    expect(voidResponse?.examples).toEqual([
      { mediaType: "application/json", json: JSON.stringify({ deleted: true }) },
    ]);
  });

  it("defaults file endpoint success response examples to fileContentType and error examples to application/json", async () => {
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";`,
          "",
          "export interface ErrorDto { message: string; }",
          "",
          'export const fileSuccessExample = { url: "https://example.com/file.csv" } satisfies { url: string };',
          'export const fileErrorExample = { message: "Not found" } satisfies ErrorDto;',
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Export: Endpoint<{",
          '    method: "GET";',
          '    route: "/api/export";',
          "    fileResponse: true;",
          '    fileContentType: "text/csv";',
          '    errors: [{ status: 404; response: ErrorDto; description: "Not found" }];',
          "    responseExamples: [",
          "      { status: 200; examples: [typeof fileSuccessExample] },",
          "      { status: 404; examples: [typeof fileErrorExample] },",
          "    ];",
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-response-example-file-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(false);

    const payload = parseContractJson(lowered.toJson());

    const exportEndpoint = payload.endpoints.find((endpoint) => endpoint.name === "export");
    const successResponse = exportEndpoint?.responses.find((r) => r.statusCode === 200);
    expect(successResponse?.examples).toEqual([
      { mediaType: "text/csv", json: JSON.stringify({ url: "https://example.com/file.csv" }) },
    ]);
    const errorResponse = exportEndpoint?.responses.find((r) => r.statusCode === 404);
    expect(errorResponse?.examples).toEqual([
      { mediaType: "application/json", json: JSON.stringify({ message: "Not found" }) },
    ]);
  });

  it("lowers a form-encoded endpoint with isFormEncoded and form-urlencoded request example media type", async () => {
    const lowered = lowerContracts(fixturePath("form-encoded-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(false);

    const payload = parseContractJson(lowered.toJson());

    expectValidContractDocument(payload);

    expect(payload.endpoints).toHaveLength(1);
    const submitForm = payload.endpoints.find((endpoint) => endpoint.name === "submitForm");
    expect(submitForm?.isFormEncoded).toBe(true);
    expect(submitForm?.params).toEqual([expect.objectContaining({ name: "body", source: "body" })]);
    expect(submitForm?.requestExamples).toEqual([
      {
        mediaType: "application/x-www-form-urlencoded",
        json: JSON.stringify({
          name: "Jane Doe",
          email: "jane@example.com",
          message: "Hello, world!",
        }),
      },
    ]);
  });

  it("defaults request example media type to application/json for non-form-encoded endpoints", async () => {
    const lowered = lowerContracts(fixturePath("request-examples-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(false);

    const payload = parseContractJson(lowered.toJson());

    const create = payload.endpoints.find((endpoint) => endpoint.name === "create");
    expect(create?.isFormEncoded).toBeUndefined();
    expect(create?.requestExamples?.[0]?.mediaType).toBe("application/json");
  });

  it("lowers a multipart endpoint with file, formField, and route params in order", async () => {
    const lowered = lowerContracts(fixturePath("multipart-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(false);

    const payload = parseContractJson(lowered.toJson());

    expectValidContractDocument(payload);

    expect(payload.endpoints).toHaveLength(1);
    const upload = payload.endpoints.find((endpoint) => endpoint.name === "uploadDocument");
    expect(upload?.inputTypeName).toBe("UploadDocumentRequest");
    expect(upload?.params).toEqual([
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
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";`,
          "",
          "export interface UploadRequest {",
          "  // Optional so the JSON request example (which cannot carry a Blob)",
          "  // stays assignable to the input type.",
          "  file?: Blob;",
          "  label: string;",
          "}",
          "",
          "export const uploadExample = {",
          '  label: "test",',
          "};",
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Upload: Endpoint<{",
          '    method: "POST";',
          '    route: "/api/upload";',
          "    input: UploadRequest;",
          "    response: void;",
          "    acceptsFile: true;",
          "    requestExamples: [typeof uploadExample];",
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-multipart-media-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);

    const payload = parseContractJson(lowered.toJson());

    const upload = payload.endpoints.find((endpoint) => endpoint.name === "upload");
    expect(upload?.params).toEqual([
      expect.objectContaining({ name: "file", source: "file" }),
      expect.objectContaining({ name: "label", source: "formField" }),
    ]);
    expect(upload?.requestExamples).toEqual([
      {
        mediaType: "multipart/form-data",
        json: JSON.stringify({ label: "test" }),
      },
    ]);
  });

  it("reports a diagnostic when a multipart endpoint has no file-typed property", async () => {
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";`,
          "",
          "export interface NoFileRequest {",
          "  title: string;",
          "  description: string;",
          "}",
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Upload: Endpoint<{",
          '    method: "POST";',
          '    route: "/api/upload";',
          "    input: NoFileRequest;",
          "    response: void;",
          "    acceptsFile: true;",
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-multipart-no-file-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_MULTIPART_INPUT",
        }),
      ]),
    );
  });

  it("reports a diagnostic when a multipart endpoint has multiple file-typed properties", async () => {
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";`,
          "",
          "export interface MultiFileRequest {",
          "  primary: Blob;",
          "  secondary: File;",
          "  title: string;",
          "}",
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Upload: Endpoint<{",
          '    method: "POST";',
          '    route: "/api/upload";',
          "    input: MultiFileRequest;",
          "    response: void;",
          "    acceptsFile: true;",
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-multipart-multi-file-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_MULTIPART_INPUT",
        }),
      ]),
    );
  });
});
