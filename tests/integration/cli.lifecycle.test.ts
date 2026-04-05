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
          requestExample: {
            data: {
              search: "Ada",
            },
          },
          successResponseExample: {
            data: [
              {
                id: "mem_123",
                email: "ada@example.com",
              },
            ],
          },
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
      endpoints: Array<{ name: string; requestExample?: unknown }>;
    };
    expect(payload.endpoints.find((endpoint) => endpoint.name === "create")).not.toHaveProperty(
      "requestExample",
    );
  });

  it("emits shorthand-property endpoint examples through the real CLI path", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-shorthand-example-cli-"));
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
      endpoints: Array<{ name: string; requestExample?: { data: unknown } }>;
    };

    expect(payload.endpoints.find((endpoint) => endpoint.name === "create")?.requestExample).toEqual(
      {
        data: {
          email: "jane@example.com",
          role: "admin",
        },
      },
    );
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
        requestExample?: { data: Record<string, unknown> };
        successResponseExample?: { data: Record<string, unknown> };
        security?: { isAnonymous: boolean };
        responses: Array<{ statusCode: number; dataType?: { name?: string } }>;
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
          requestExample: {
            data: {
              name: "Ada",
            },
          },
          successResponseExample: {
            data: {
              ok: true,
              echoedName: "Ada",
            },
          },
          responses: expect.arrayContaining([
            expect.objectContaining({
              statusCode: 201,
              dataType: expect.objectContaining({ name: "PingResponse" }),
            }),
          ]),
        }),
      ]),
    );
  }, 60000);
});
