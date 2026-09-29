// Contract-discovery diagnostics and authored-metadata coverage for the
// single AST→document pass (X13 collapse). This file is the converted
// successor of extract-ts-contracts.lifecycle.test.ts: bundle-IR assertions
// (TypeExpression .text, referencedTypes, bundle successStatus/security) died
// with the ContractBundle IR; every surviving fact is asserted against the
// lowered RivetContractDocument or the lowering diagnostics, with the same
// diagnostic codes and file paths the frontend used to report.
import path from "node:path";
import { lowerContracts } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { writeContractProject } from "../support/contract-project.js";
import { parseContractJson } from "../support/lower.js";
import { AUTHORING_TYPES, fixturePath } from "../support/paths.js";

const parseDocument = (lowered: { toJson(): string }) => parseContractJson(lowered.toJson());

const writeTempEntry = async (
  prefix: string,
  fileLines: readonly string[],
): Promise<{ tempDirectory: string; entryPath: string }> => {
  const entryPath = await writeContractProject(
    {
      "contracts.ts": fileLines.join("\n").replaceAll("__IMPORT_PATH__", AUTHORING_TYPES),
    },
    prefix,
  );
  const tempDirectory = path.dirname(entryPath);

  return { tempDirectory, entryPath };
};

describe("Contract discovery lifecycle", () => {
  it("discovers contracts and lowers endpoint metadata from a real TS fixture program", async () => {
    const lowered = lowerContracts(fixturePath("members-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.contracts).toHaveLength(1);
    expect(lowered.contracts[0]?.name).toBe("MembersContract");
    expect(lowered.contracts[0]?.endpoints).toHaveLength(5);
    expect(lowered.contracts[0]?.endpoints.map((endpoint) => endpoint.name)).toEqual([
      "List",
      "Invite",
      "Remove",
      "UpdateRole",
      "Health",
    ]);

    const payload = parseDocument(lowered);
    const byName = new Map(payload.endpoints.map((endpoint) => [endpoint.name, endpoint]));

    expect(byName.get("list")).toMatchObject({
      httpMethod: "GET",
      routeTemplate: "/api/members",
      description: "List all team members",
    });

    const invite = byName.get("invite");
    expect(invite).toMatchObject({
      httpMethod: "POST",
      routeTemplate: "/api/members",
      security: expect.objectContaining({ scheme: "admin" }),
    });
    expect(invite?.responses.map((response) => response.statusCode)).toEqual([201, 422]);
    expect(invite?.responses.find((response) => response.statusCode === 422)).toMatchObject({
      description: "Validation failed",
    });

    const health = byName.get("health");
    expect(health).toMatchObject({
      httpMethod: "GET",
      routeTemplate: "/api/health",
      description: "Health check",
      security: expect.objectContaining({ isAnonymous: true }),
    });
  });

  it("lowers the broader supported endpoint metadata surface from the public DSL", async () => {
    const lowered = lowerContracts(fixturePath("expressive-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);
    expect(lowered.contracts).toHaveLength(1);
    expect(lowered.contracts[0]?.name).toBe("MembersContract");
    expect(lowered.contracts[0]?.endpoints).toHaveLength(5);

    const payload = parseDocument(lowered);
    const byName = new Map(payload.endpoints.map((endpoint) => [endpoint.name, endpoint]));

    expect(byName.get("search")).toMatchObject({
      httpMethod: "GET",
      routeTemplate: "/api/teams/{teamId}/members",
      summary: "Search members",
      description: "Search members in a team",
    });

    const create = byName.get("create");
    expect(create).toMatchObject({
      httpMethod: "POST",
      routeTemplate: "/api/teams/{teamId}/members",
      security: expect.objectContaining({ scheme: "admin" }),
    });
    expect(create?.responses.map((response) => response.statusCode)).toEqual([201, 422]);
    expect(create?.responses.find((response) => response.statusCode === 422)).toMatchObject({
      description: "Validation failed",
    });

    const update = byName.get("update");
    expect(update?.responses.find((response) => response.statusCode === 404)).toMatchObject({
      description: "Member not found",
    });

    expect(byName.get("exportMembers")).toMatchObject({
      httpMethod: "GET",
      routeTemplate: "/api/teams/{teamId}/members/export",
      fileContentType: "text/csv",
      summary: "Export members",
      description: "Download members as CSV",
      security: expect.objectContaining({ scheme: "admin" }),
    });

    expect(byName.get("ping")).toMatchObject({
      httpMethod: "GET",
      routeTemplate: "/api/ping",
      description: "Anonymous liveness probe",
      security: expect.objectContaining({ isAnonymous: true }),
    });
  });

  it("carries extracted endpoint examples through the lowered Rivet contract document", async () => {
    const lowered = lowerContracts(fixturePath("expressive-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(false);

    const payload = parseDocument(lowered);
    const create = payload.endpoints.find((endpoint) => endpoint.name === "create");

    expect(create?.requestExamples).toEqual([
      {
        json: JSON.stringify({
          teamId: "550e8400-e29b-41d4-a716-446655440000",
          email: "jane@example.com",
          status: "active",
          priority: 2,
          profile: {
            displayName: "Jane Example",
            timezone: "Europe/London",
          },
          metadata: {
            invitesSent: 3,
            logins: 12,
          },
        }),
        mediaType: "application/json",
      },
    ]);
    const successResponse = create?.responses.find((response) => response.statusCode === 201);
    expect(successResponse?.examples).toEqual([
      {
        mediaType: "application/json",
        json: JSON.stringify({
          data: {
            id: "550e8400-e29b-41d4-a716-446655440001",
            email: "jane@example.com",
            status: "active",
            priority: 2,
            managerId: null,
            coordinates: {
              lat: 51.5074,
              lng: -0.1278,
            },
          },
          included: ["profile", "audit"],
        }),
      },
    ]);
    expect(create).not.toHaveProperty("successResponseExample");
  });

  it("lowers aliased endpoint authoring specs exported from the public DSL", async () => {
    const lowered = lowerContracts(fixturePath("aliased-authoring-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);
    expect(lowered.contracts).toHaveLength(1);
    expect(lowered.contracts[0]?.name).toBe("AliasedMembersContract");
    expect(lowered.contracts[0]?.endpoints).toHaveLength(1);

    const payload = parseDocument(lowered);
    const list = payload.endpoints.find((endpoint) => endpoint.name === "list");

    expect(list).toMatchObject({
      httpMethod: "GET",
      routeTemplate: "/api/aliased-members",
      summary: "List aliased members",
      description: "List members from an aliased endpoint spec",
      security: expect.objectContaining({ scheme: "admin" }),
    });
    expect(list?.requestExamples).toEqual([
      {
        json: JSON.stringify({ search: "Ada" }),
        mediaType: "application/json",
      },
    ]);
    expect(list?.responses.find((response) => response.statusCode === 200)?.examples).toEqual([
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
    expect(list?.responses.find((response) => response.statusCode === 404)).toMatchObject({
      description: "Members not found",
    });
  });

  it.each([
    ["tuple syntax", "[typeof createMemberRequestExample]"],
    ["readonly tuple syntax", "readonly [typeof createMemberRequestExample]"],
    ["Array helper syntax", "Array<typeof createMemberRequestExample>"],
    ["ReadonlyArray helper syntax", "ReadonlyArray<typeof createMemberRequestExample>"],
  ])("lowers requestExamples authored via %s", async (_, requestExamplesType) => {
    const { entryPath } = await writeTempEntry("rivet-ts-request-examples-", [
      'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
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
      `    requestExamples: ${requestExamplesType};`,
      "    response: void;",
      "  }>;",
      "}",
      "",
    ]);

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(false);
    const payload = parseDocument(lowered);
    expect(payload.endpoints[0]?.requestExamples).toEqual([
      {
        json: JSON.stringify({ email: "jane@example.com" }),
        mediaType: "application/json",
      },
    ]);
  });

  it("lowers named inline and ref-backed request example descriptors in authored order", async () => {
    const { entryPath } = await writeTempEntry("rivet-ts-request-examples-v2-", [
      'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
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
    ]);

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);
    const payload = parseDocument(lowered);
    expect(payload.endpoints[0]?.requestExamples).toEqual([
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

  it("discovers contracts from a temp consumer entry without requiring local node ambient types", async () => {
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";`,
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Ping: Endpoint<{",
          '    method: "GET";',
          '    route: "/api/ping";',
          "    response: void;",
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-consumer-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);
    expect(lowered.contracts).toHaveLength(1);
    expect(lowered.contracts[0]?.name).toBe("TempContract");
  });

  it.each([
    ["readonly-array syntax", "readonly ValidationFailure[]"],
    ["Array helper syntax", "Array<ValidationFailure>"],
    ["ReadonlyArray helper syntax", "ReadonlyArray<ValidationFailure>"],
  ])("lowers array-authored error metadata from the public DSL via %s", async (_, errorsType) => {
    const { entryPath } = await writeTempEntry("rivet-ts-errors-array-", [
      'import type { Contract, Endpoint, EndpointErrorAuthoringSpec } from "__IMPORT_PATH__";',
      "",
      "type ValidationFailure = EndpointErrorAuthoringSpec & {",
      "  status: 422;",
      '  description: "Validation failed";',
      "  response: ValidationErrorDto;",
      "};",
      "",
      "export interface ValidationErrorDto {",
      "  message: string;",
      "}",
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
    ]);

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);
    const payload = parseDocument(lowered);
    const create = payload.endpoints.find((endpoint) => endpoint.name === "create");
    expect(create?.responses.map((response) => response.statusCode)).toEqual([201, 422]);
    expect(create?.responses.find((response) => response.statusCode === 422)).toMatchObject({
      description: "Validation failed",
    });
  });

  it.each([
    [
      "non-typeof example reference",
      [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        "interface CreateMemberRequest {",
        "  email: string;",
        "}",
        "",
        'export interface TempContract extends Contract<"TempContract"> {',
        "  Create: Endpoint<{",
        '    method: "POST";',
        '    route: "/api/temp";',
        "    requestExample: CreateMemberRequest;",
        "    response: void;",
        "  }>;",
        "}",
        "",
      ],
      "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
    ],
    [
      "spread-heavy const initializer",
      [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
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
      ],
      "UNSUPPORTED_ENDPOINT_EXAMPLE_VALUE",
    ],
    [
      "non-exported const reference",
      [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        "interface CreateMemberRequest {",
        "  email: string;",
        "}",
        "",
        "const createMemberRequestExample = {",
        '  email: "jane@example.com",',
        "} satisfies CreateMemberRequest;",
        "",
        'export interface TempContract extends Contract<"TempContract"> {',
        "  Create: Endpoint<{",
        '    method: "POST";',
        '    route: "/api/temp";',
        "    requestExample: typeof createMemberRequestExample;",
        "    response: void;",
        "  }>;",
        "}",
        "",
      ],
      "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
    ],
    [
      "request example without matching input",
      [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        "interface CreateMemberRequest {",
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
        "    requestExample: typeof createMemberRequestExample;",
        "    response: void;",
        "  }>;",
        "}",
        "",
      ],
      "INVALID_ENDPOINT_EXAMPLE_TYPE",
    ],
    [
      "success response example without matching response",
      [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        "interface CreateMemberResponse {",
        "  id: string;",
        "}",
        "",
        "export const createMemberResponseExample = {",
        '  id: "mem_123",',
        "} satisfies CreateMemberResponse;",
        "",
        'export interface TempContract extends Contract<"TempContract"> {',
        "  Create: Endpoint<{",
        '    method: "POST";',
        '    route: "/api/temp";',
        "    input: { email: string };",
        "    successResponseExample: typeof createMemberResponseExample;",
        "  }>;",
        "}",
        "",
      ],
      "INVALID_ENDPOINT_EXAMPLE_TYPE",
    ],
  ])(
    "reports diagnostics for malformed endpoint examples via %s",
    async (_, fileLines, expectedCode) => {
      const { entryPath } = await writeTempEntry("rivet-ts-examples-invalid-", fileLines);

      const lowered = lowerContracts(entryPath);

      expect(lowered.hasErrors).toBe(true);
      expect(lowered.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: expectedCode,
            filePath: entryPath,
          }),
        ]),
      );
      const payload = parseDocument(lowered);
      expect(payload.endpoints.find((endpoint) => endpoint.name === "create")).not.toHaveProperty(
        "requestExamples",
      );
    },
  );

  it("reports compiler diagnostics when an example reference resolves to a non-JSON-like value type", async () => {
    const { entryPath } = await writeTempEntry("rivet-ts-examples-typecheck-", [
      'import type { Contract, Endpoint, EndpointExampleAuthoringReference } from "__IMPORT_PATH__";',
      "",
      "export const createMemberRequestExample = {",
      '  email: "jane@example.com",',
      '  normalize: () => "jane@example.com",',
      "};",
      "",
      "const checkedExample: EndpointExampleAuthoringReference<typeof createMemberRequestExample> =",
      "  createMemberRequestExample;",
      "",
      'export interface TempContract extends Contract<"TempContract"> {',
      "  Create: Endpoint<{",
      '    method: "POST";',
      '    route: "/api/temp";',
      "    requestExample: typeof createMemberRequestExample;",
      "    response: void;",
      "  }>;",
      "}",
      "",
    ]);

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.stringMatching(/^TS\d+$/),
          filePath: entryPath,
          message: expect.stringContaining("normalize"),
        }),
      ]),
    );
  });

  it("reports compiler diagnostics when request and response examples do not match the endpoint DTO types", async () => {
    const { entryPath } = await writeTempEntry("rivet-ts-examples-mismatched-types-", [
      'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
      "",
      "export interface CreateMemberRequest {",
      "  email: string;",
      "}",
      "",
      "interface MemberDto {",
      "  id: string;",
      "}",
      "",
      "export const wrongRequestExample = {",
      '  id: "mem_123",',
      "} satisfies MemberDto;",
      "",
      "export const wrongResponseExample = {",
      '  email: "jane@example.com",',
      "} satisfies CreateMemberRequest;",
      "",
      'export interface TempContract extends Contract<"TempContract"> {',
      "  Create: Endpoint<{",
      '    method: "POST";',
      '    route: "/api/temp";',
      "    input: CreateMemberRequest;",
      "    response: MemberDto;",
      "    requestExample: typeof wrongRequestExample;",
      "    successResponseExample: typeof wrongResponseExample;",
      "  }>;",
      "}",
      "",
    ]);

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.stringMatching(/^TS\d+$/),
          filePath: entryPath,
          message: expect.stringContaining("requestExample"),
        }),
        expect.objectContaining({
          code: expect.stringMatching(/^TS\d+$/),
          filePath: entryPath,
          message: expect.stringContaining("successResponseExample"),
        }),
      ]),
    );
  });

  it("rejects mismatched endpoint examples in the discovery stage when type-surface diagnostics are bypassed", async () => {
    const { entryPath } = await writeTempEntry("rivet-ts-examples-mismatched-bypass-", [
      'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
      "",
      "export interface CreateMemberRequest {",
      "  email: string;",
      "}",
      "",
      "interface MemberDto {",
      "  id: string;",
      "}",
      "",
      "export const wrongRequestExample = {",
      '  id: "mem_123",',
      "} satisfies MemberDto;",
      "",
      "export const wrongResponseExample = {",
      '  email: "jane@example.com",',
      "} satisfies CreateMemberRequest;",
      "",
      'export interface TempContract extends Contract<"TempContract"> {',
      "  Create: Endpoint<{",
      '    method: "POST";',
      '    route: "/api/temp";',
      "    input: CreateMemberRequest;",
      "    response: MemberDto;",
      "    // @ts-ignore bypass DSL check to exercise extractor-side validation",
      "    requestExample: typeof wrongRequestExample;",
      "    // @ts-ignore bypass DSL check to exercise extractor-side validation",
      "    successResponseExample: typeof wrongResponseExample;",
      "  }>;",
      "}",
      "",
    ]);

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_ENDPOINT_EXAMPLE_TYPE",
          filePath: entryPath,
          message: expect.stringContaining("requestExample"),
        }),
        expect.objectContaining({
          code: "INVALID_ENDPOINT_EXAMPLE_TYPE",
          filePath: entryPath,
          message: expect.stringContaining("successResponseExample"),
        }),
      ]),
    );
    const payload = parseDocument(lowered);
    expect(payload.endpoints.find((endpoint) => endpoint.name === "create")).not.toHaveProperty(
      "requestExamples",
    );
  });

  it("attributes imported malformed example diagnostics to the source module that declares the initializer", async () => {
    const entryPath = await writeContractProject(
      {
        "examples.ts": [
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
        ].join("\n"),
        "contracts.ts": [
          `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";`,
          'import { createMemberRequestExample } from "./examples.js";',
          "",
          "interface CreateMemberRequest {",
          "  email: string;",
          "  role: string;",
          "}",
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
      "rivet-ts-examples-imported-",
    );
    const tempDirectory = path.dirname(entryPath);
    const examplesPath = path.join(tempDirectory, "examples.ts");

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_ENDPOINT_EXAMPLE_VALUE",
          filePath: examplesPath,
        }),
      ]),
    );
  });

  it("lowers shorthand-property example objects", async () => {
    const { entryPath } = await writeTempEntry("rivet-ts-examples-shorthand-", [
      'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
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
    ]);

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(false);
    const payload = parseDocument(lowered);
    expect(payload.endpoints[0]?.requestExamples).toEqual([
      {
        json: JSON.stringify({
          email: "jane@example.com",
          role: "admin",
        }),
        mediaType: "application/json",
      },
    ]);
  });

  it("resolves identifier references to other const initializers in example values", async () => {
    const { entryPath } = await writeTempEntry("rivet-ts-examples-identifier-", [
      'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
      "",
      "export interface ItemDto { name: string; tags: string[]; }",
      "export interface ResponseDto { item: ItemDto; total: number; }",
      "",
      'const item = { name: "widget", tags: ["a", "b"] };',
      "export const responseExample = { item, total: 1 } satisfies ResponseDto;",
      "",
      'export interface TempContract extends Contract<"TempContract"> {',
      "  Get: Endpoint<{",
      '    method: "GET";',
      '    route: "/api/temp";',
      "    response: ResponseDto;",
      "    responseExamples: [{ status: 200; examples: [typeof responseExample] }];",
      "  }>;",
      "}",
      "",
    ]);

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(false);
    const payload = parseDocument(lowered);
    expect(
      payload.endpoints[0]?.responses.find((response) => response.statusCode === 200)?.examples,
    ).toEqual([
      {
        mediaType: "application/json",
        json: JSON.stringify({
          item: { name: "widget", tags: ["a", "b"] },
          total: 1,
        }),
      },
    ]);
  });

  it("resolves string concatenation in example values", async () => {
    const { entryPath } = await writeTempEntry("rivet-ts-examples-concat-", [
      'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
      "",
      "export interface CsvDto { content: string; }",
      "",
      'export const csvExample = { content: "a,b\\n" + "1,2\\n" } satisfies CsvDto;',
      "",
      'export interface TempContract extends Contract<"TempContract"> {',
      "  Get: Endpoint<{",
      '    method: "GET";',
      '    route: "/api/temp";',
      "    response: CsvDto;",
      "    responseExamples: [{ status: 200; examples: [typeof csvExample] }];",
      "  }>;",
      "}",
      "",
    ]);

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(false);
    const payload = parseDocument(lowered);
    expect(
      payload.endpoints[0]?.responses.find((response) => response.statusCode === 200)?.examples,
    ).toEqual([
      {
        mediaType: "application/json",
        json: JSON.stringify({ content: "a,b\n1,2\n" }),
      },
    ]);
  });

  it.each([
    ["non-array errors type", "string", "INVALID_ERRORS_SPEC"],
    ["non-object error entry", "Array<string>", "INVALID_ERROR_ENTRY"],
    [
      "helper error entry without literal status",
      "Array<EndpointErrorAuthoringSpec>",
      "MISSING_ERROR_STATUS",
    ],
  ])(
    "reports diagnostics for malformed error metadata via %s",
    async (_, errorsType, expectedCode) => {
      const entryPath = await writeContractProject(
        {
          "contracts.ts": [
            `import type { Contract, Endpoint, EndpointErrorAuthoringSpec } from "${AUTHORING_TYPES}";`,
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
        "rivet-ts-errors-invalid-",
      );

      const lowered = lowerContracts(entryPath);

      expect(lowered.hasErrors).toBe(true);
      expect(lowered.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: expectedCode,
            filePath: entryPath,
          }),
        ]),
      );
      const payload = parseDocument(lowered);
      const create = payload.endpoints.find((endpoint) => endpoint.name === "create");
      expect(create?.responses).toEqual([expect.objectContaining({ statusCode: 201 })]);
    },
  );

  it("reports diagnostics when security uses the helper shape without a string literal scheme", async () => {
    const entryPath = await writeContractProject(
      {
        "contracts.ts": [
          `import type { Contract, Endpoint, EndpointSecurityAuthoringSpec } from "${AUTHORING_TYPES}";`,
          "",
          'export interface TempContract extends Contract<"TempContract"> {',
          "  Create: Endpoint<{",
          '    method: "POST";',
          '    route: "/api/temp";',
          "    response: void;",
          "    security: EndpointSecurityAuthoringSpec;",
          "  }>;",
          "}",
          "",
        ].join("\n"),
      },
      "rivet-ts-security-helper-",
    );

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_SECURITY_SPEC",
          filePath: entryPath,
          message: expect.stringContaining("security.scheme as a string literal"),
        }),
      ]),
    );
  });

  it("reports compiler diagnostics when endpoint metadata includes unsupported keys", async () => {
    const lowered = lowerContracts(fixturePath("invalid-authoring-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.stringMatching(/^TS\d+$/),
          filePath: expect.stringContaining(
            path.join("tests", "fixtures", "invalid-authoring-contract", "contracts.ts"),
          ),
          message: expect.stringContaining("topLevelExtra"),
        }),
        expect.objectContaining({
          code: expect.stringMatching(/^TS\d+$/),
          filePath: expect.stringContaining(
            path.join("tests", "fixtures", "invalid-authoring-contract", "contracts.ts"),
          ),
          message: expect.stringContaining("securityExtra"),
        }),
        expect.objectContaining({
          code: expect.stringMatching(/^TS\d+$/),
          filePath: expect.stringContaining(
            path.join("tests", "fixtures", "invalid-authoring-contract", "contracts.ts"),
          ),
          message: expect.stringContaining("errorExtra"),
        }),
      ]),
    );
  });

  it("lowers status-scoped response examples from the dedicated fixture", async () => {
    const lowered = lowerContracts(fixturePath("response-examples-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);

    const payload = parseDocument(lowered);
    const create = payload.endpoints.find((endpoint) => endpoint.name === "create");

    expect(create?.responses.find((response) => response.statusCode === 201)?.examples).toEqual([
      {
        mediaType: "application/json",
        json: JSON.stringify({ id: "mem_001", email: "jane@example.com" }),
      },
      {
        mediaType: "application/json",
        json: JSON.stringify({ id: "mem_002", email: "alex@example.com" }),
      },
    ]);
    expect(create?.responses.find((response) => response.statusCode === 422)?.examples).toEqual([
      {
        mediaType: "application/json",
        json: JSON.stringify({ message: "Email is required", code: "VALIDATION_ERROR" }),
      },
    ]);
  });

  it("normalizes legacy successResponseExample into status-scoped response examples", async () => {
    const lowered = lowerContracts(fixturePath("response-examples-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(false);

    const payload = parseDocument(lowered);
    const legacy = payload.endpoints.find((endpoint) => endpoint.name === "legacyCreate");

    expect(legacy?.responses.find((response) => response.statusCode === 201)?.examples).toEqual([
      {
        mediaType: "application/json",
        json: JSON.stringify({ id: "mem_legacy", email: "legacy@example.com" }),
      },
    ]);
    expect(legacy).not.toHaveProperty("successResponseExample");
  });

  it("reports a diagnostic when both requestExample and requestExamples are declared", async () => {
    const { entryPath } = await writeTempEntry("rivet-ts-conflicting-request-examples-", [
      'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
      "",
      "export interface CreateRequest { email: string; }",
      "",
      'export const example1 = { email: "a@example.com" } satisfies CreateRequest;',
      'export const example2 = { email: "b@example.com" } satisfies CreateRequest;',
      "",
      'export interface TempContract extends Contract<"TempContract"> {',
      "  Create: Endpoint<{",
      '    method: "POST";',
      '    route: "/api/temp";',
      "    input: CreateRequest;",
      "    response: void;",
      "    requestExample: typeof example1;",
      "    requestExamples: [typeof example2];",
      "  }>;",
      "}",
      "",
    ]);

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONFLICTING_REQUEST_EXAMPLE_SPEC",
        }),
      ]),
    );
  });

  it("reports a diagnostic when both successResponseExample and responseExamples are declared", async () => {
    const { entryPath } = await writeTempEntry("rivet-ts-conflicting-response-examples-", [
      'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
      "",
      "export interface MemberDto { id: string; }",
      "",
      'export const example1 = { id: "mem_1" } satisfies MemberDto;',
      'export const example2 = { id: "mem_2" } satisfies MemberDto;',
      "",
      'export interface TempContract extends Contract<"TempContract"> {',
      "  Get: Endpoint<{",
      '    method: "GET";',
      '    route: "/api/temp";',
      "    response: MemberDto;",
      "    successResponseExample: typeof example1;",
      "    responseExamples: [{ status: 200; examples: [typeof example2] }];",
      "  }>;",
      "}",
      "",
    ]);

    const lowered = lowerContracts(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONFLICTING_RESPONSE_EXAMPLE_SPEC",
        }),
      ]),
    );
  });

  it("lowers the formEncoded flag from a form-encoded endpoint", async () => {
    const lowered = lowerContracts(fixturePath("form-encoded-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(false);

    const payload = parseDocument(lowered);
    const submitForm = payload.endpoints.find((endpoint) => endpoint.name === "submitForm");
    expect(submitForm).toMatchObject({
      httpMethod: "POST",
      routeTemplate: "/api/forms",
      isFormEncoded: true,
    });
  });

  it("defaults formEncoded to false when not declared", async () => {
    const lowered = lowerContracts(fixturePath("request-examples-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(false);

    const payload = parseDocument(lowered);
    expect(payload.endpoints.length).toBeGreaterThan(0);
    for (const endpoint of payload.endpoints) {
      // isFormEncoded is emitted on the wire only when true.
      expect(endpoint).not.toHaveProperty("isFormEncoded");
    }
  });
});
