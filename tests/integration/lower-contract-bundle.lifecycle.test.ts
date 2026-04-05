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

const readJsonFixture = async (relativePath: string): Promise<unknown> => {
  const fileContents = await fs.readFile(getFixturePath(relativePath), "utf8");
  return JSON.parse(fileContents) as unknown;
};

describe("LowerContractBundleToRivetContract lifecycle", () => {
  it("lowers an extracted contract bundle into Rivet contract JSON", async () => {
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);

    const bundle = await extractUseCase.execute({
      entryPath: getFixturePath(path.join("members-contract", "contracts.ts")),
    });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);

    const payload = JSON.parse(lowered.toJson()) as {
      endpoints: Array<{ name: string; controllerName: string }>;
    };
    expect(payload).toEqual(
      await readJsonFixture(path.join("members-contract", "golden-contract.json")),
    );
    expect(payload.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "invite", controllerName: "members" }),
        expect.objectContaining({ name: "updateRole", controllerName: "members" }),
      ]),
    );
  });

  it("lowers aliased endpoint-spec examples into Rivet contract JSON", async () => {
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);

    const bundle = await extractUseCase.execute({
      entryPath: getFixturePath(path.join("aliased-authoring-contract", "contracts.ts")),
    });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(bundle.hasErrors).toBe(false);
    expect(lowered.hasErrors).toBe(false);

    const payload = JSON.parse(lowered.toJson()) as {
      endpoints: Array<{
        name: string;
        requestExamples?: Array<{ json: Record<string, unknown>; mediaType: string }>;
        successResponseExample?: { data: unknown };
      }>;
    };

    expect(payload.endpoints.find((endpoint) => endpoint.name === "list")).toMatchObject({
      requestExamples: [
        {
          json: {
            search: "Ada",
          },
          mediaType: "application/json",
        },
      ],
      successResponseExample: {
        data: [
          {
            id: "mem_123",
            email: "ada@example.com",
          },
        ],
      },
    });
  });

  it("lowers plural inline request examples from the dedicated fixture", async () => {
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);

    const bundle = await extractUseCase.execute({
      entryPath: getFixturePath(path.join("request-examples-contract", "contracts.ts")),
    });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(bundle.hasErrors).toBe(false);
    expect(lowered.hasErrors).toBe(false);

    const payload = JSON.parse(lowered.toJson()) as unknown;
    const writeFixture = process.env.UPDATE_GOLDEN === "1";
    const goldenPath = getFixturePath(
      path.join("request-examples-contract", "golden-contract.json"),
    );
    if (writeFixture) {
      await fs.writeFile(goldenPath, `${lowered.toJson()}\n`, "utf8");
    }

    const expected = await readJsonFixture(
      path.join("request-examples-contract", "golden-contract.json"),
    );
    expect(payload).toEqual(expected);

    const typedPayload = payload as {
      endpoints: Array<{
        name: string;
        requestExamples?: Array<{ json: Record<string, unknown>; mediaType: string }>;
      }>;
    };

    expect(typedPayload.endpoints.find((endpoint) => endpoint.name === "create")).toMatchObject({
      requestExamples: [
        {
          json: {
            email: "jane@example.com",
            role: "admin",
          },
          mediaType: "application/json",
        },
        {
          json: {
            email: "alex@example.com",
            role: "reviewer",
          },
          mediaType: "application/json",
        },
      ],
    });
    expect(
      typedPayload.endpoints.find((endpoint) => endpoint.name === "legacyCreate"),
    ).toMatchObject({
      requestExamples: [
        {
          json: {
            email: "legacy@example.com",
            role: "member",
          },
          mediaType: "application/json",
        },
      ],
    });
    expect(typedPayload.endpoints.every((endpoint) => !("requestExample" in endpoint))).toBe(true);
  });

  it("lowers named inline and ref-backed request example descriptors without reordering or reshaping them", async () => {
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);
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
      "utf8",
    );

    const bundle = await extractUseCase.execute({ entryPath });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(bundle.hasErrors).toBe(false);
    expect(lowered.hasErrors).toBe(false);

    const payload = JSON.parse(lowered.toJson()) as {
      endpoints: Array<{
        name: string;
        requestExamples?: Array<{
          name?: string;
          mediaType: string;
          json?: Record<string, unknown>;
          componentExampleId?: string;
          resolvedJson?: Record<string, unknown>;
        }>;
      }>;
    };

    expect(
      payload.endpoints.find((endpoint) => endpoint.name === "create")?.requestExamples,
    ).toEqual([
      {
        json: {
          email: "jane@example.com",
          role: "admin",
        },
        mediaType: "application/json",
      },
      {
        name: "plain-text",
        mediaType: "text/plain",
        json: {
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

  it("reports request example descriptors that mix inline and ref-backed fields", async () => {
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "rivet-ts-invalid-request-example-descriptor-"),
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
        '        json: typeof createMemberRequestExample;',
        '        componentExampleId: "CreateMemberExample";',
        "        resolvedJson: typeof createMemberRequestExample;",
        "      },",
        "    ];",
        "  }>;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const bundle = await extractUseCase.execute({ entryPath });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(bundle.hasErrors).toBe(true);
    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_ENDPOINT_EXAMPLE_REFERENCE",
          filePath: entryPath,
        }),
      ]),
    );

    const payload = JSON.parse(lowered.toJson()) as {
      endpoints: Array<{ name: string; requestExamples?: unknown }>;
    };
    expect(payload.endpoints.find((endpoint) => endpoint.name === "create")).not.toHaveProperty(
      "requestExamples",
    );
  });

  it.each([
    ["readonly-array syntax", "readonly ValidationFailure[]"],
    ["Array helper syntax", "Array<ValidationFailure>"],
    ["ReadonlyArray helper syntax", "ReadonlyArray<ValidationFailure>"],
  ])("lowers array-authored endpoint errors from the public DSL via %s", async (_, errorsType) => {
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-lower-errors-array-"));
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
      "utf8",
    );

    const bundle = await extractUseCase.execute({ entryPath });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(bundle.hasErrors).toBe(false);
    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);

    const payload = JSON.parse(lowered.toJson()) as {
      endpoints: Array<{
        name: string;
        responses: Array<{
          statusCode: number;
          description?: string;
          dataType?: { name?: string };
        }>;
      }>;
    };
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
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "rivet-ts-lower-invalid-example-"),
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
      "utf8",
    );

    const bundle = await extractUseCase.execute({ entryPath });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(bundle.hasErrors).toBe(true);
    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_ENDPOINT_EXAMPLE_VALUE",
          filePath: entryPath,
        }),
      ]),
    );

    const payload = JSON.parse(lowered.toJson()) as {
      endpoints: Array<{ name: string; requestExamples?: unknown }>;
    };
    expect(payload.endpoints.find((endpoint) => endpoint.name === "create")).not.toHaveProperty(
      "requestExamples",
    );
  });

  it("lowers scalar and array-root endpoint examples without wrapping or reshaping them", async () => {
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-root-examples-"));
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
      "utf8",
    );

    const bundle = await extractUseCase.execute({ entryPath });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(bundle.hasErrors).toBe(false);
    expect(lowered.hasErrors).toBe(false);

    const payload = JSON.parse(lowered.toJson()) as {
      endpoints: Array<{
        name: string;
        successResponseExample?: { data: unknown };
      }>;
    };

    expect(
      payload.endpoints.find((endpoint) => endpoint.name === "tags")?.successResponseExample,
    ).toEqual({
      data: ["alpha", "beta"],
    });
    expect(
      payload.endpoints.find((endpoint) => endpoint.name === "version")?.successResponseExample,
    ).toEqual({
      data: 3,
    });
  });

  it("lowers shorthand-property endpoint examples through the full bundle pipeline", async () => {
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-shorthand-example-"));
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
      "utf8",
    );

    const bundle = await extractUseCase.execute({ entryPath });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(bundle.hasErrors).toBe(false);
    expect(lowered.hasErrors).toBe(false);

    const payload = JSON.parse(lowered.toJson()) as {
      endpoints: Array<{
        name: string;
        requestExamples?: Array<{ json: unknown; mediaType: string }>;
      }>;
    };

    expect(
      payload.endpoints.find((endpoint) => endpoint.name === "create")?.requestExamples,
    ).toEqual([
      {
        json: {
          email: "jane@example.com",
          role: "admin",
        },
        mediaType: "application/json",
      },
    ]);
  });

  it("defaults file responses to application/octet-stream when fileContentType is omitted", async () => {
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-file-response-"));
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
        "  Download: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/download";',
        "    fileResponse: true;",
        "  }>;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const bundle = await extractUseCase.execute({ entryPath });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(bundle.hasErrors).toBe(false);
    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);

    const payload = JSON.parse(lowered.toJson()) as {
      endpoints: Array<{
        name: string;
        fileContentType?: string;
        responses: Array<{ statusCode: number }>;
      }>;
    };
    const downloadEndpoint = payload.endpoints.find((endpoint) => endpoint.name === "download");

    expect(downloadEndpoint).toMatchObject({
      fileContentType: "application/octet-stream",
    });
    expect(downloadEndpoint?.responses).toEqual(
      expect.arrayContaining([expect.objectContaining({ statusCode: 200 })]),
    );
  });

  it("reports contradictory anonymous and security metadata instead of silently dropping security", async () => {
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "rivet-ts-conflicting-security-"),
    );
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
        "    anonymous: true;",
        '    security: { scheme: "admin" };',
        "  }>;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const bundle = await extractUseCase.execute({ entryPath });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(bundle.hasErrors).toBe(false);
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
});
