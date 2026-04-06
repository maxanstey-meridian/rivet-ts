import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runCli } from "../../src/interfaces/cli/run-cli.js";

const execFileAsync = promisify(execFile);

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

describe("CLI lifecycle", () => {
  it("writes Rivet contract JSON to an output file", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-"));
    const outputPath = path.join(tempDirectory, "contract.json");
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(
      [
        "--entry",
        getFixturePath(path.join("members-contract", "contracts.ts")),
        "--out",
        outputPath,
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = JSON.parse(fileContents) as {
      endpoints: Array<{ name: string; routeTemplate: string }>;
    };

    expect(payload).toEqual(
      await readJsonFixture(path.join("members-contract", "golden-contract.json")),
    );
    expect(payload.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "invite", routeTemplate: "/api/members" }),
        expect.objectContaining({ name: "updateRole", routeTemplate: "/api/members/{id}/role" }),
      ]),
    );
  });

  it("writes Rivet contract JSON for aliased endpoint specs through the real CLI path", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-"));
    const outputPath = path.join(tempDirectory, "aliased-contract.json");
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(
      [
        "--entry",
        getFixturePath(path.join("aliased-authoring-contract", "contracts.ts")),
        "--out",
        outputPath,
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = JSON.parse(fileContents) as {
      types: Array<{
        name: string;
        properties: Array<{ name: string }>;
      }>;
      endpoints: Array<{
        name: string;
        routeTemplate: string;
        returnType?: { kind: string; element?: { kind: string; name?: string } };
        summary?: string;
        description?: string;
        security?: { scheme?: string; isAnonymous: boolean };
        responses: Array<{
          statusCode: number;
          description?: string;
          dataType?: { kind: string; element?: { kind: string; name?: string } };
        }>;
      }>;
    };

    expect(payload.types).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "MemberDto",
          properties: expect.arrayContaining([
            expect.objectContaining({ name: "id" }),
            expect.objectContaining({ name: "email" }),
          ]),
        }),
      ]),
    );

    expect(payload.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "list",
          routeTemplate: "/api/aliased-members",
          requestExamples: [
            {
              json: JSON.stringify({
                search: "Ada",
              }),
              mediaType: "application/json",
            },
          ],
          returnType: {
            kind: "array",
            element: {
              kind: "ref",
              name: "MemberDto",
            },
          },
          summary: "List aliased members",
          description: "List members from an aliased endpoint spec",
          security: {
            isAnonymous: false,
            scheme: "admin",
          },
          responses: expect.arrayContaining([
            expect.objectContaining({
              statusCode: 200,
              dataType: {
                kind: "array",
                element: {
                  kind: "ref",
                  name: "MemberDto",
                },
              },
              examples: [
                {
                  mediaType: "application/json",
                  json: JSON.stringify([
                    {
                      id: "mem_123",
                      email: "ada@example.com",
                    },
                  ]),
                },
              ],
            }),
            expect.objectContaining({
              statusCode: 404,
              description: "Members not found",
            }),
          ]),
        }),
      ]),
    );
  });

  it("writes plural requestExamples JSON for the dedicated fixture through the real CLI path", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-request-examples-"));
    const outputPath = path.join(tempDirectory, "request-examples-contract.json");
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(
      [
        "--entry",
        getFixturePath(path.join("request-examples-contract", "contracts.ts")),
        "--out",
        outputPath,
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = JSON.parse(fileContents) as unknown;

    expect(payload).toEqual(
      await readJsonFixture(path.join("request-examples-contract", "golden-contract.json")),
    );

    const typedPayload = payload as {
      endpoints: Array<{
        name: string;
        requestExamples?: Array<{ json: string; mediaType: string }>;
      }>;
    };

    expect(typedPayload.endpoints.find((endpoint) => endpoint.name === "create")).toMatchObject({
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
    expect(typedPayload.endpoints.every((endpoint) => !("requestExample" in endpoint))).toBe(true);
  });

  it("writes status-scoped response examples JSON for the dedicated fixture through the real CLI path", async () => {
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "rivet-ts-response-examples-cli-"),
    );
    const outputPath = path.join(tempDirectory, "response-examples-contract.json");
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(
      [
        "--entry",
        getFixturePath(path.join("response-examples-contract", "contracts.ts")),
        "--out",
        outputPath,
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = JSON.parse(fileContents) as unknown;

    expect(payload).toEqual(
      await readJsonFixture(path.join("response-examples-contract", "golden-contract.json")),
    );

    const typedPayload = payload as {
      endpoints: Array<{
        name: string;
        responses: Array<{
          statusCode: number;
          examples?: Array<{ mediaType: string; json: string }>;
        }>;
      }>;
    };

    const create = typedPayload.endpoints.find((endpoint) => endpoint.name === "create");
    const create201 = create?.responses.find((r) => r.statusCode === 201);
    expect(create201?.examples).toEqual([
      {
        mediaType: "application/json",
        json: JSON.stringify({ id: "mem_001", email: "jane@example.com" }),
      },
      {
        mediaType: "application/json",
        json: JSON.stringify({ id: "mem_002", email: "alex@example.com" }),
      },
    ]);
    const create422 = create?.responses.find((r) => r.statusCode === 422);
    expect(create422?.examples).toEqual([
      {
        mediaType: "application/json",
        json: JSON.stringify({ message: "Email is required", code: "VALIDATION_ERROR" }),
      },
    ]);

    const legacy = typedPayload.endpoints.find((endpoint) => endpoint.name === "legacyCreate");
    const legacy201 = legacy?.responses.find((r) => r.statusCode === 201);
    expect(legacy201?.examples).toEqual([
      {
        mediaType: "application/json",
        json: JSON.stringify({ id: "mem_legacy", email: "legacy@example.com" }),
      },
    ]);

    expect(
      typedPayload.endpoints.every((endpoint) => !("successResponseExample" in endpoint)),
    ).toBe(true);
  });

  it("writes named inline and ref-backed request examples through the real CLI path", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-request-examples-v2-"));
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const outputPath = path.join(tempDirectory, "contract.json");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );
    const stdout: string[] = [];
    const stderr: string[] = [];

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

    const exitCode = await runCli(["--entry", entryPath, "--out", outputPath], {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = JSON.parse(fileContents) as {
      endpoints: Array<{
        name: string;
        requestExamples?: Array<{
          name?: string;
          mediaType: string;
          json?: string;
          componentExampleId?: string;
          resolvedJson?: string;
        }>;
      }>;
    };

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

  it("reports request example descriptors that mix inline and ref-backed fields through the real CLI path", async () => {
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "rivet-ts-invalid-request-example-descriptor-cli-"),
    );
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const outputPath = path.join(tempDirectory, "contract.json");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );
    const stdout: string[] = [];
    const stderr: string[] = [];

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
        "        json: typeof createMemberRequestExample;",
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

    const exitCode = await runCli(["--entry", entryPath, "--out", outputPath], {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(0);
    const requestExampleDiagnostics = stderr.filter((line) =>
      line.includes("[INVALID_ENDPOINT_EXAMPLE_REFERENCE]"),
    );
    expect(requestExampleDiagnostics).toHaveLength(1);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = JSON.parse(fileContents) as {
      endpoints: Array<{ name: string; requestExamples?: unknown }>;
    };
    expect(payload.endpoints.find((endpoint) => endpoint.name === "create")).not.toHaveProperty(
      "requestExamples",
    );
  });

  it("reports invalid security helper usage through the real CLI path", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-invalid-security-"));
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const outputPath = path.join(tempDirectory, "contract.json");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );
    const stdout: string[] = [];
    const stderr: string[] = [];

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

    const exitCode = await runCli(["--entry", entryPath, "--out", outputPath], {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(0);
    const invalidSecurityDiagnostics = stderr.filter((line) =>
      line.includes("[INVALID_SECURITY_SPEC]"),
    );
    expect(invalidSecurityDiagnostics).toHaveLength(1);
    expect(invalidSecurityDiagnostics[0]).toContain("security.scheme as a string literal");
  });

  it("reports contradictory anonymous and security metadata through the real CLI path", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-conflicting-cli-"));
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const outputPath = path.join(tempDirectory, "contract.json");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );
    const stdout: string[] = [];
    const stderr: string[] = [];

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

    const exitCode = await runCli(["--entry", entryPath, "--out", outputPath], {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(0);
    const conflictingSecurityDiagnostics = stderr.filter((line) =>
      line.includes("[CONFLICTING_SECURITY_SPEC]"),
    );
    expect(conflictingSecurityDiagnostics).toHaveLength(1);
    expect(conflictingSecurityDiagnostics[0]).toContain(
      "cannot declare both anonymous and security",
    );
  });

  it("propagates malformed endpoint example diagnostics through the real CLI path", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-invalid-example-cli-"));
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const outputPath = path.join(tempDirectory, "contract.json");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );
    const stdout: string[] = [];
    const stderr: string[] = [];

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

    const exitCode = await runCli(["--entry", entryPath, "--out", outputPath], {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(0);
    const exampleDiagnostics = stderr.filter((line) =>
      line.includes("[UNSUPPORTED_ENDPOINT_EXAMPLE_VALUE]"),
    );
    expect(exampleDiagnostics).toHaveLength(1);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = JSON.parse(fileContents) as {
      endpoints: Array<{ name: string; requestExamples?: unknown }>;
    };
    expect(payload.endpoints.find((endpoint) => endpoint.name === "create")).not.toHaveProperty(
      "requestExamples",
    );
  });

  it("emits shorthand-property endpoint examples through the real CLI path", async () => {
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "rivet-ts-shorthand-example-cli-"),
    );
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const outputPath = path.join(tempDirectory, "contract.json");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );
    const stdout: string[] = [];
    const stderr: string[] = [];

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

    const exitCode = await runCli(["--entry", entryPath, "--out", outputPath], {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = JSON.parse(fileContents) as {
      endpoints: Array<{
        name: string;
        requestExamples?: Array<{ json: unknown; mediaType: string }>;
      }>;
    };

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

  it.each([
    ["non-array errors type", "string", "INVALID_ERRORS_SPEC"],
    ["non-object error entry", "Array<string>", "INVALID_ERROR_ENTRY"],
    [
      "helper error entry without literal status",
      "Array<EndpointErrorAuthoringSpec>",
      "MISSING_ERROR_STATUS",
    ],
  ])(
    "reports malformed error metadata through the real CLI path via %s",
    async (_, errorsType, expectedCode) => {
      const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-invalid-errors-"));
      const entryPath = path.join(tempDirectory, "contracts.ts");
      const outputPath = path.join(tempDirectory, "contract.json");
      const normalizedImportPath = toImportPath(
        tempDirectory,
        path.join(getProjectRoot(), "dist", "index.js"),
      );
      const stdout: string[] = [];
      const stderr: string[] = [];

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

      const exitCode = await runCli(["--entry", entryPath, "--out", outputPath], {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      });

      expect(exitCode).toBe(1);
      expect(stdout).toHaveLength(0);
      const errorDiagnostics = stderr.filter((line) => line.includes(`[${expectedCode}]`));
      expect(errorDiagnostics.length).toBeGreaterThan(0);

      const fileContents = await fs.readFile(outputPath, "utf8");
      const payload = JSON.parse(fileContents) as {
        endpoints: Array<{
          name: string;
          responses: Array<{ statusCode: number; description?: string }>;
        }>;
      };
      const createEndpoint = payload.endpoints.find((endpoint) => endpoint.name === "create");

      expect(createEndpoint?.responses).toEqual([expect.objectContaining({ statusCode: 201 })]);
    },
  );

  it("supports the documented installed-consumer package import and CLI bin path", async () => {
    const packDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-pack-"));
    const consumerDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-consumer-"));
    const { stdout: packStdout } = await execFileAsync(
      "pnpm",
      ["pack", "--pack-destination", packDirectory],
      {
        cwd: getProjectRoot(),
      },
    );
    const tarballName = packStdout.trim().split("\n").at(-1);
    if (!tarballName) {
      throw new Error("pnpm pack did not return a tarball name");
    }

    const tarballPath = path.isAbsolute(tarballName)
      ? tarballName
      : path.join(packDirectory, tarballName);

    await fs.writeFile(
      path.join(consumerDirectory, "package.json"),
      JSON.stringify(
        {
          name: "rivet-ts-consumer-smoke",
          private: true,
          type: "module",
          dependencies: {
            "rivet-ts": tarballPath,
          },
          pnpm: {
            overrides: {
              typescript: `file:${path.join(getProjectRoot(), "node_modules", "typescript")}`,
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await execFileAsync("pnpm", ["install", "--offline"], {
      cwd: consumerDirectory,
    });

    await fs.writeFile(
      path.join(consumerDirectory, "contracts.ts"),
      [
        'import type { Contract, Endpoint } from "rivet-ts";',
        "",
        "export interface CreatePingRequest {",
        "  name: string;",
        "}",
        "",
        "export interface PingResponse {",
        "  ok: boolean;",
        "  echoedName: string;",
        "}",
        "",
        "export const createPingRequestExample = {",
        '  name: "Ada",',
        "} satisfies CreatePingRequest;",
        "",
        "export const pingResponseExample = {",
        "  ok: true,",
        '  echoedName: "Ada",',
        "} satisfies PingResponse;",
        "",
        'export interface HealthContract extends Contract<"HealthContract"> {',
        "  CreatePing: Endpoint<{",
        '    method: "POST";',
        '    route: "/api/ping";',
        "    input: CreatePingRequest;",
        "    response: PingResponse;",
        "    requestExample: typeof createPingRequestExample;",
        "    successResponseExample: typeof pingResponseExample;",
        '    description: "Installed consumer ping";',
        "  }>;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    await execFileAsync(
      "pnpm",
      ["exec", "rivet-reflect-ts", "--entry", "contracts.ts", "--out", "contract.json"],
      {
        cwd: consumerDirectory,
      },
    );

    const payload = JSON.parse(
      await fs.readFile(path.join(consumerDirectory, "contract.json"), "utf8"),
    ) as {
      types: Array<{ name: string }>;
      endpoints: Array<{
        name: string;
        routeTemplate: string;
        description?: string;
        requestExamples?: Array<{ json: string; mediaType: string }>;
        security?: { isAnonymous: boolean };
        responses: Array<{
          statusCode: number;
          dataType?: { name?: string };
          examples?: Array<{ mediaType: string; json: string }>;
        }>;
      }>;
    };

    expect(payload.types).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "CreatePingRequest" }),
        expect.objectContaining({ name: "PingResponse" }),
      ]),
    );
    expect(payload.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "createPing",
          routeTemplate: "/api/ping",
          description: "Installed consumer ping",
          requestExamples: [
            {
              json: JSON.stringify({
                name: "Ada",
              }),
              mediaType: "application/json",
            },
          ],
          responses: expect.arrayContaining([
            expect.objectContaining({
              statusCode: 201,
              dataType: expect.objectContaining({ name: "PingResponse" }),
              examples: [
                {
                  mediaType: "application/json",
                  json: JSON.stringify({
                    ok: true,
                    echoedName: "Ada",
                  }),
                },
              ],
            }),
          ]),
        }),
      ]),
    );
  }, 60000);

  it("writes Rivet contract JSON for a form-encoded endpoint through the real CLI path", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-form-encoded-"));
    const outputPath = path.join(tempDirectory, "form-encoded-contract.json");
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(
      [
        "--entry",
        getFixturePath(path.join("form-encoded-contract", "contracts.ts")),
        "--out",
        outputPath,
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = JSON.parse(fileContents) as {
      endpoints: Array<{
        name: string;
        isFormEncoded?: boolean;
        requestExamples?: Array<{ mediaType: string; json: string }>;
      }>;
    };

    expect(payload).toEqual(
      await readJsonFixture(path.join("form-encoded-contract", "golden-contract.json")),
    );

    const submitForm = payload.endpoints.find((endpoint) => endpoint.name === "submitForm");
    expect(submitForm?.isFormEncoded).toBe(true);
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

  it("writes Rivet contract JSON for a multipart endpoint through the real CLI path", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-multipart-"));
    const outputPath = path.join(tempDirectory, "multipart-contract.json");
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(
      [
        "--entry",
        getFixturePath(path.join("multipart-contract", "contracts.ts")),
        "--out",
        outputPath,
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = JSON.parse(fileContents) as {
      endpoints: Array<{
        name: string;
        inputTypeName?: string;
        params: Array<{ name: string; source: string; type: { kind: string; type?: string } }>;
      }>;
    };

    expect(payload).toEqual(
      await readJsonFixture(path.join("multipart-contract", "golden-contract.json")),
    );

    const upload = payload.endpoints.find((endpoint) => endpoint.name === "uploadDocument");
    expect(upload?.inputTypeName).toBe("UploadDocumentRequest");
    expect(upload?.params.map((p) => ({ name: p.name, source: p.source }))).toEqual([
      { name: "documentId", source: "route" },
      { name: "file", source: "file" },
      { name: "title", source: "formField" },
      { name: "description", source: "formField" },
    ]);
    expect(upload?.params.find((p) => p.source === "file")?.type).toEqual({
      kind: "primitive",
      type: "File",
    });
  });
});
