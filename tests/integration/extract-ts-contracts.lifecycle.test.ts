import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExtractTsContracts } from "../../src/application/use-cases/extract-ts-contracts.js";
import { LowerContractBundleToRivetContract } from "../../src/application/use-cases/lower-contract-bundle-to-rivet-contract.js";
import { TypeScriptContractFrontend } from "../../src/infrastructure/typescript/typescript-contract-frontend.js";
import { TypeScriptRivetContractLowerer } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";

const getProjectRoot = (): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "..");
};

const toImportPath = (fromDirectory: string, targetFilePath: string): string => {
  const relativePath = path.relative(fromDirectory, targetFilePath).split(path.sep).join("/");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
};

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

describe("ExtractTsContracts lifecycle", () => {
  it("extracts a contract bundle from a real TS fixture program", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);

    const bundle = await useCase.execute({
      entryPath: getFixturePath(path.join("members-contract", "contracts.ts")),
    });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.contracts).toHaveLength(1);
    expect(bundle.referencedTypes).toEqual(
      expect.arrayContaining([
        "InviteMemberRequest",
        "InviteMemberResponse",
        "MemberDto",
        "NotFoundDto",
        "PagedResult",
        "UpdateRoleRequest",
        "ValidationErrorDto",
      ]),
    );

    const [contract] = bundle.contracts;
    expect(contract.name).toBe("MembersContract");
    expect(contract.endpoints).toHaveLength(5);

    const list = contract.endpoints.find((endpoint) => endpoint.name === "List");
    expect(list).toMatchObject({
      method: "GET",
      route: "/api/members",
      description: "List all team members",
    });
    expect(list?.response?.text).toBe("PagedResult<MemberDto>");

    const invite = contract.endpoints.find((endpoint) => endpoint.name === "Invite");
    expect(invite).toMatchObject({
      method: "POST",
      route: "/api/members",
      successStatus: 201,
      security: {
        scheme: "admin",
      },
    });
    expect(invite).not.toHaveProperty("securityScheme");
    expect(invite?.input?.text).toBe("InviteMemberRequest");
    expect(invite?.response?.text).toBe("InviteMemberResponse");
    expect(invite?.errors).toHaveLength(1);
    expect(invite?.errors[0]).toMatchObject({
      status: 422,
      description: "Validation failed",
    });

    const health = contract.endpoints.find((endpoint) => endpoint.name === "Health");
    expect(health).toMatchObject({
      method: "GET",
      route: "/api/health",
      anonymous: true,
      description: "Health check",
    });
    expect(health?.security).toBeUndefined();
    expect(health?.response).toBeUndefined();
  });

  it("extracts the broader supported endpoint metadata surface from the public DSL", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);

    const bundle = await useCase.execute({
      entryPath: getFixturePath(path.join("expressive-contract", "contracts.ts")),
    });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.diagnostics).toEqual([]);
    expect(bundle.contracts).toHaveLength(1);

    const [contract] = bundle.contracts;
    expect(contract.name).toBe("MembersContract");
    expect(contract.endpoints).toHaveLength(5);

    const search = contract.endpoints.find((endpoint) => endpoint.name === "Search");
    expect(search).toMatchObject({
      method: "GET",
      route: "/api/teams/{teamId}/members",
      summary: "Search members",
      description: "Search members in a team",
    });
    expect(search?.input?.text).toBe("SearchMembersQuery");
    expect(search?.response?.text).toBe("PagedResult<MemberDto>");

    const create = contract.endpoints.find((endpoint) => endpoint.name === "Create");
    expect(create).toMatchObject({
      method: "POST",
      route: "/api/teams/{teamId}/members",
      successStatus: 201,
      security: {
        scheme: "admin",
      },
    });
    expect(create).not.toHaveProperty("securityScheme");
    expect(create?.input?.text).toBe("CreateMemberRequest");
    expect(create?.response?.text).toBe("MemberEnvelope<MemberDto>");
    expect(create?.requestExamples).toEqual([
      {
        data: {
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
        },
      },
    ]);
    expect(create?.responseExamples).toEqual([
      {
        status: 201,
        examples: [
          {
            data: {
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
            },
          },
        ],
      },
    ]);
    expect(create?.errors).toEqual([
      expect.objectContaining({
        status: 422,
        description: "Validation failed",
      }),
    ]);
    expect(create?.errors[0]?.response?.text).toBe("ValidationErrorDto");

    const update = contract.endpoints.find((endpoint) => endpoint.name === "Update");
    expect(update?.errors).toEqual([
      expect.objectContaining({
        status: 404,
        description: "Member not found",
      }),
    ]);

    const exportMembers = contract.endpoints.find((endpoint) => endpoint.name === "ExportMembers");
    expect(exportMembers).toMatchObject({
      method: "GET",
      route: "/api/teams/{teamId}/members/export",
      fileResponse: true,
      fileContentType: "text/csv",
      summary: "Export members",
      description: "Download members as CSV",
      security: {
        scheme: "admin",
      },
    });
    expect(exportMembers).not.toHaveProperty("securityScheme");
    expect(exportMembers?.response).toBeUndefined();

    const ping = contract.endpoints.find((endpoint) => endpoint.name === "Ping");
    expect(ping).toMatchObject({
      method: "GET",
      route: "/api/ping",
      anonymous: true,
      description: "Anonymous liveness probe",
    });
    expect(ping?.security).toBeUndefined();
  });

  it("carries extracted endpoint examples through the lowered Rivet contract document", async () => {
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);

    const bundle = await extractUseCase.execute({
      entryPath: getFixturePath(path.join("expressive-contract", "contracts.ts")),
    });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(bundle.hasErrors).toBe(false);
    expect(lowered.hasErrors).toBe(false);

    const payload = JSON.parse(lowered.toJson()) as {
      endpoints: Array<{
        name: string;
        requestExamples?: Array<{ json: string; mediaType: string }>;
        responses: Array<{
          statusCode: number;
          examples?: Array<{ mediaType: string; json: string }>;
        }>;
      }>;
    };
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

  it("extracts aliased endpoint authoring specs exported from the public DSL", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);

    const bundle = await useCase.execute({
      entryPath: getFixturePath(path.join("aliased-authoring-contract", "contracts.ts")),
    });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.diagnostics).toEqual([]);
    expect(bundle.contracts).toHaveLength(1);

    const [contract] = bundle.contracts;
    expect(contract.name).toBe("AliasedMembersContract");
    expect(contract.endpoints).toHaveLength(1);

    expect(contract.endpoints[0]).toMatchObject({
      name: "List",
      method: "GET",
      route: "/api/aliased-members",
      summary: "List aliased members",
      description: "List members from an aliased endpoint spec",
      security: {
        scheme: "admin",
      },
    });
    expect(contract.endpoints[0]).not.toHaveProperty("securityScheme");
    expect(contract.endpoints[0]?.input?.text).toBe("ListMembersQuery");
    expect(contract.endpoints[0]?.response?.text).toBe("MemberDto[]");
    expect(contract.endpoints[0]?.requestExamples).toEqual([
      {
        data: {
          search: "Ada",
        },
      },
    ]);
    expect(contract.endpoints[0]?.responseExamples).toEqual([
      {
        status: 200,
        examples: [
          {
            data: [
              {
                id: "mem_123",
                email: "ada@example.com",
              },
            ],
          },
        ],
      },
    ]);
    expect(contract.endpoints[0]?.errors).toEqual([
      expect.objectContaining({
        status: 404,
        description: "Members not found",
      }),
    ]);
  });

  it("extracts ordered plural request examples and normalizes legacy requestExample sugar", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);

    const bundle = await useCase.execute({
      entryPath: getFixturePath(path.join("request-examples-contract", "contracts.ts")),
    });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.diagnostics).toEqual([]);

    const contract = bundle.contracts[0];
    const create = contract?.endpoints.find((endpoint) => endpoint.name === "Create");
    const legacy = contract?.endpoints.find((endpoint) => endpoint.name === "LegacyCreate");

    expect(create?.requestExamples).toEqual([
      {
        data: {
          email: "jane@example.com",
          role: "admin",
        },
      },
      {
        data: {
          email: "alex@example.com",
          role: "reviewer",
        },
      },
    ]);
    expect(legacy?.requestExamples).toEqual([
      {
        data: {
          email: "legacy@example.com",
          role: "member",
        },
      },
    ]);
  });

  it.each([
    ["tuple syntax", "[typeof createMemberRequestExample]"],
    ["readonly tuple syntax", "readonly [typeof createMemberRequestExample]"],
    ["Array helper syntax", "Array<typeof createMemberRequestExample>"],
    ["ReadonlyArray helper syntax", "ReadonlyArray<typeof createMemberRequestExample>"],
  ])("extracts requestExamples authored via %s", async (_, requestExamplesType) => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-request-examples-"));
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );

    await fs.writeFile(path.join(tempDirectory, "package.json"), '{ "type": "module" }\n', "utf8");

    await fs.writeFile(
      entryPath,
      [
        `import type { Contract, Endpoint } from "${normalizedImportPath}";`,
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
        "    input: CreateMemberRequest;",
        `    requestExamples: ${requestExamplesType};`,
        "    response: void;",
        "  }>;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const bundle = await useCase.execute({ entryPath });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.contracts[0]?.endpoints[0]?.requestExamples).toEqual([
      {
        data: {
          email: "jane@example.com",
        },
      },
    ]);
  });

  it("extracts named inline and ref-backed request example descriptors in authored order", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-request-examples-v2-"));
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );

    await fs.writeFile(path.join(tempDirectory, "package.json"), '{ "type": "module" }\n', "utf8");

    await fs.writeFile(
      entryPath,
      [
        `import type { Contract, Endpoint } from "${normalizedImportPath}";`,
        "",
        "interface CreateMemberRequest {",
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
      "utf8",
    );

    const bundle = await useCase.execute({ entryPath });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.diagnostics).toEqual([]);
    expect(bundle.contracts[0]?.endpoints[0]?.requestExamples).toEqual([
      {
        data: {
          email: "jane@example.com",
          role: "admin",
        },
      },
      {
        name: "plain-text",
        mediaType: "text/plain",
        data: {
          email: "alex@example.com",
          role: "reviewer",
        },
      },
      {
        name: "component-backed",
        mediaType: "application/json",
        componentExampleId: "CreateMemberExample",
        resolvedJson: {
          email: "component@example.com",
          role: "member",
        },
      },
    ]);
  });

  it("extracts contracts from a temp consumer entry without requiring local node ambient types", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-consumer-"));
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );

    await fs.writeFile(
      entryPath,
      [
        `import type { Contract, Endpoint } from "${normalizedImportPath}";`,
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
      "utf8",
    );

    const bundle = await useCase.execute({ entryPath });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.diagnostics).toEqual([]);
    expect(bundle.contracts).toHaveLength(1);
    expect(bundle.contracts[0]?.name).toBe("TempContract");
  });

  it.each([
    ["readonly-array syntax", "readonly ValidationFailure[]"],
    ["Array helper syntax", "Array<ValidationFailure>"],
    ["ReadonlyArray helper syntax", "ReadonlyArray<ValidationFailure>"],
  ])("extracts array-authored error metadata from the public DSL via %s", async (_, errorsType) => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-errors-array-"));
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );

    await fs.writeFile(
      entryPath,
      [
        `import type { Contract, Endpoint, EndpointErrorAuthoringSpec } from "${normalizedImportPath}";`,
        "",
        "type ValidationFailure = EndpointErrorAuthoringSpec & {",
        "  status: 422;",
        '  description: "Validation failed";',
        "  response: ValidationErrorDto;",
        "};",
        "",
        "interface ValidationErrorDto {",
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
      ].join("\n"),
      "utf8",
    );

    const bundle = await useCase.execute({ entryPath });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.diagnostics).toEqual([]);
    expect(bundle.contracts).toHaveLength(1);
    expect(bundle.contracts[0]?.endpoints[0]?.errors).toEqual([
      expect.objectContaining({
        status: 422,
        description: "Validation failed",
      }),
    ]);
    expect(bundle.contracts[0]?.endpoints[0]?.errors[0]?.response?.text).toBe("ValidationErrorDto");
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
      const frontend = new TypeScriptContractFrontend();
      const useCase = new ExtractTsContracts(frontend);
      const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-examples-invalid-"));
      const entryPath = path.join(tempDirectory, "contracts.ts");
      const normalizedImportPath = toImportPath(
        tempDirectory,
        path.join(getProjectRoot(), "dist", "index.js"),
      );

      await fs.writeFile(
        path.join(tempDirectory, "package.json"),
        '{ "type": "module" }\n',
        "utf8",
      );

      await fs.writeFile(
        entryPath,
        fileLines.join("\n").replaceAll("__IMPORT_PATH__", normalizedImportPath),
        "utf8",
      );

      const bundle = await useCase.execute({ entryPath });

      expect(bundle.hasErrors).toBe(true);
      expect(bundle.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: expectedCode,
            filePath: entryPath,
          }),
        ]),
      );
      expect(bundle.contracts[0]?.endpoints[0]?.requestExamples).toEqual([]);
    },
  );

  it("reports compiler diagnostics when an example reference resolves to a non-JSON-like value type", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-examples-typecheck-"));
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );

    await fs.writeFile(path.join(tempDirectory, "package.json"), '{ "type": "module" }\n', "utf8");

    await fs.writeFile(
      entryPath,
      [
        `import type { Contract, Endpoint, EndpointExampleAuthoringReference } from "${normalizedImportPath}";`,
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
      ].join("\n"),
      "utf8",
    );

    const bundle = await useCase.execute({ entryPath });

    expect(bundle.hasErrors).toBe(true);
    expect(bundle.diagnostics).toEqual(
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
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "rivet-ts-examples-mismatched-types-"),
    );
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );

    await fs.writeFile(path.join(tempDirectory, "package.json"), '{ "type": "module" }\n', "utf8");

    await fs.writeFile(
      entryPath,
      [
        `import type { Contract, Endpoint } from "${normalizedImportPath}";`,
        "",
        "interface CreateMemberRequest {",
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
      ].join("\n"),
      "utf8",
    );

    const bundle = await useCase.execute({ entryPath });

    expect(bundle.hasErrors).toBe(true);
    expect(bundle.diagnostics).toEqual(
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

  it("rejects mismatched endpoint examples in the extractor when type-surface diagnostics are bypassed", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "rivet-ts-examples-mismatched-bypass-"),
    );
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );

    await fs.writeFile(path.join(tempDirectory, "package.json"), '{ "type": "module" }\n', "utf8");

    await fs.writeFile(
      entryPath,
      [
        `import type { Contract, Endpoint } from "${normalizedImportPath}";`,
        "",
        "interface CreateMemberRequest {",
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
      ].join("\n"),
      "utf8",
    );

    const bundle = await useCase.execute({ entryPath });

    expect(bundle.hasErrors).toBe(true);
    expect(bundle.diagnostics).toEqual(
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
    expect(bundle.contracts[0]?.endpoints[0]?.requestExamples).toEqual([]);
  });

  it("attributes imported malformed example diagnostics to the source module that declares the initializer", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-examples-imported-"));
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const examplesPath = path.join(tempDirectory, "examples.ts");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );

    await fs.writeFile(path.join(tempDirectory, "package.json"), '{ "type": "module" }\n', "utf8");

    await fs.writeFile(
      examplesPath,
      [
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
      "utf8",
    );

    await fs.writeFile(
      entryPath,
      [
        `import type { Contract, Endpoint } from "${normalizedImportPath}";`,
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
      "utf8",
    );

    const bundle = await useCase.execute({ entryPath });

    expect(bundle.hasErrors).toBe(true);
    expect(bundle.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_ENDPOINT_EXAMPLE_VALUE",
          filePath: examplesPath,
        }),
      ]),
    );
  });

  it("extracts shorthand-property example objects", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-examples-shorthand-"));
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );

    await fs.writeFile(path.join(tempDirectory, "package.json"), '{ "type": "module" }\n', "utf8");

    await fs.writeFile(
      entryPath,
      [
        `import type { Contract, Endpoint } from "${normalizedImportPath}";`,
        "",
        "interface CreateMemberRequest {",
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
      "utf8",
    );

    const bundle = await useCase.execute({ entryPath });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.contracts[0]?.endpoints[0]?.requestExamples).toEqual([
      {
        data: {
          email: "jane@example.com",
          role: "admin",
        },
      },
    ]);
  });

  it("resolves identifier references to other const initializers in example values", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-examples-identifier-"));
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );

    await fs.writeFile(path.join(tempDirectory, "package.json"), '{ "type": "module" }\n', "utf8");

    await fs.writeFile(
      entryPath,
      [
        `import type { Contract, Endpoint } from "${normalizedImportPath}";`,
        "",
        "interface ItemDto { name: string; tags: string[]; }",
        "interface ResponseDto { item: ItemDto; total: number; }",
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
      ].join("\n"),
      "utf8",
    );

    const bundle = await useCase.execute({ entryPath });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.contracts[0]?.endpoints[0]?.responseExamples).toEqual([
      {
        status: 200,
        examples: [
          {
            data: {
              item: { name: "widget", tags: ["a", "b"] },
              total: 1,
            },
          },
        ],
      },
    ]);
  });

  it("resolves string concatenation in example values", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-examples-concat-"));
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );

    await fs.writeFile(path.join(tempDirectory, "package.json"), '{ "type": "module" }\n', "utf8");

    await fs.writeFile(
      entryPath,
      [
        `import type { Contract, Endpoint } from "${normalizedImportPath}";`,
        "",
        "interface CsvDto { content: string; }",
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
      ].join("\n"),
      "utf8",
    );

    const bundle = await useCase.execute({ entryPath });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.contracts[0]?.endpoints[0]?.responseExamples).toEqual([
      {
        status: 200,
        examples: [
          {
            data: {
              content: "a,b\n1,2\n",
            },
          },
        ],
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
      const frontend = new TypeScriptContractFrontend();
      const useCase = new ExtractTsContracts(frontend);
      const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-errors-invalid-"));
      const entryPath = path.join(tempDirectory, "contracts.ts");
      const normalizedImportPath = toImportPath(
        tempDirectory,
        path.join(getProjectRoot(), "dist", "index.js"),
      );

      await fs.writeFile(
        entryPath,
        [
          `import type { Contract, Endpoint, EndpointErrorAuthoringSpec } from "${normalizedImportPath}";`,
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
        "utf8",
      );

      const bundle = await useCase.execute({ entryPath });

      expect(bundle.hasErrors).toBe(true);
      expect(bundle.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: expectedCode,
            filePath: entryPath,
          }),
        ]),
      );
      expect(bundle.contracts[0]?.endpoints[0]?.errors ?? []).toEqual([]);
    },
  );

  it("reports diagnostics when security uses the helper shape without a string literal scheme", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-security-helper-"));
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );

    await fs.writeFile(
      entryPath,
      [
        `import type { Contract, Endpoint, EndpointSecurityAuthoringSpec } from "${normalizedImportPath}";`,
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
      "utf8",
    );

    const bundle = await useCase.execute({ entryPath });

    expect(bundle.hasErrors).toBe(true);
    expect(bundle.diagnostics).toEqual(
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
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);

    const bundle = await useCase.execute({
      entryPath: getFixturePath(path.join("invalid-authoring-contract", "contracts.ts")),
    });

    expect(bundle.hasErrors).toBe(true);
    expect(bundle.diagnostics).toEqual(
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

  it("extracts status-scoped response examples from the dedicated fixture", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);

    const bundle = await useCase.execute({
      entryPath: getFixturePath(path.join("response-examples-contract", "contracts.ts")),
    });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.diagnostics).toEqual([]);

    const contract = bundle.contracts[0];
    const create = contract?.endpoints.find((endpoint) => endpoint.name === "Create");

    expect(create?.responseExamples).toEqual([
      {
        status: 201,
        examples: [
          { data: { id: "mem_001", email: "jane@example.com" } },
          { data: { id: "mem_002", email: "alex@example.com" } },
        ],
      },
      {
        status: 422,
        examples: [{ data: { message: "Email is required", code: "VALIDATION_ERROR" } }],
      },
    ]);
  });

  it("normalizes legacy successResponseExample into status-scoped responseExamples", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);

    const bundle = await useCase.execute({
      entryPath: getFixturePath(path.join("response-examples-contract", "contracts.ts")),
    });

    expect(bundle.hasErrors).toBe(false);

    const contract = bundle.contracts[0];
    const legacy = contract?.endpoints.find((endpoint) => endpoint.name === "LegacyCreate");

    expect(legacy?.responseExamples).toEqual([
      {
        status: 201,
        examples: [{ data: { id: "mem_legacy", email: "legacy@example.com" } }],
      },
    ]);
  });

  it("reports a diagnostic when both requestExample and requestExamples are declared", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "rivet-ts-conflicting-request-examples-"),
    );
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );

    await fs.writeFile(path.join(tempDirectory, "package.json"), '{ "type": "module" }\n', "utf8");

    await fs.writeFile(
      entryPath,
      [
        `import type { Contract, Endpoint } from "${normalizedImportPath}";`,
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
      ].join("\n"),
      "utf8",
    );

    const bundle = await useCase.execute({ entryPath });

    expect(bundle.hasErrors).toBe(true);
    expect(bundle.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONFLICTING_REQUEST_EXAMPLE_SPEC",
        }),
      ]),
    );
  });

  it("reports a diagnostic when both successResponseExample and responseExamples are declared", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "rivet-ts-conflicting-response-examples-"),
    );
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );

    await fs.writeFile(path.join(tempDirectory, "package.json"), '{ "type": "module" }\n', "utf8");

    await fs.writeFile(
      entryPath,
      [
        `import type { Contract, Endpoint } from "${normalizedImportPath}";`,
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
      ].join("\n"),
      "utf8",
    );

    const bundle = await useCase.execute({ entryPath });

    expect(bundle.hasErrors).toBe(true);
    expect(bundle.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONFLICTING_RESPONSE_EXAMPLE_SPEC",
        }),
      ]),
    );
  });

  it("extracts formEncoded flag from a form-encoded endpoint", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);

    const bundle = await useCase.execute({
      entryPath: getFixturePath(path.join("form-encoded-contract", "contracts.ts")),
    });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.contracts).toHaveLength(1);

    const [contract] = bundle.contracts;
    const submitForm = contract.endpoints.find((endpoint) => endpoint.name === "SubmitForm");
    expect(submitForm).toMatchObject({
      method: "POST",
      route: "/api/forms",
      formEncoded: true,
    });
  });

  it("defaults formEncoded to false when not declared", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);

    const bundle = await useCase.execute({
      entryPath: getFixturePath(path.join("request-examples-contract", "contracts.ts")),
    });

    expect(bundle.hasErrors).toBe(false);

    const [contract] = bundle.contracts;
    for (const endpoint of contract.endpoints) {
      expect(endpoint.formEncoded).toBe(false);
    }
  });
});
