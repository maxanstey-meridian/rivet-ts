import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expectValidContractDocument } from "../contract-schema.js";
import { runCliCaptured } from "../support/cli.js";
import { writeContractProject } from "../support/contract-project.js";
import { parseContractJson } from "../support/lower.js";
import { AUTHORING_TYPES, PROJECT_ROOT, fixturePath } from "../support/paths.js";
import { tempDir } from "../support/temp.js";

const execFileAsync = promisify(execFile);

describe("CLI lifecycle", () => {
  it("writes Rivet contract JSON to an output file", async () => {
    const tempDirectory = await tempDir("rivet-ts-");
    const outputPath = path.join(tempDirectory, "contract.json");
    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      fixturePath("members-contract", "contracts.ts"),
      "--out",
      outputPath,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = parseContractJson(fileContents);

    expectValidContractDocument(payload);

    expect(payload.endpoints).toHaveLength(5);
    expect(payload.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "invite",
          httpMethod: "POST",
          routeTemplate: "/api/members",
          params: [expect.objectContaining({ name: "body", source: "body", isOptional: false })],
          responses: [
            expect.objectContaining({ statusCode: 201 }),
            expect.objectContaining({ statusCode: 422 }),
          ],
        }),
        expect.objectContaining({
          name: "updateRole",
          httpMethod: "PUT",
          routeTemplate: "/api/members/{id}/role",
        }),
      ]),
    );
  });

  it("writes Rivet contract JSON for aliased endpoint specs through the real CLI path", async () => {
    const tempDirectory = await tempDir("rivet-ts-");
    const outputPath = path.join(tempDirectory, "aliased-contract.json");
    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      fixturePath("aliased-authoring-contract", "contracts.ts"),
      "--out",
      outputPath,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = parseContractJson(fileContents);

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
    const tempDirectory = await tempDir("rivet-ts-request-examples-");
    const outputPath = path.join(tempDirectory, "request-examples-contract.json");
    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      fixturePath("request-examples-contract", "contracts.ts"),
      "--out",
      outputPath,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = parseContractJson(fileContents);

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
    expect(payload.endpoints.every((endpoint) => !("requestExample" in endpoint))).toBe(true);
  });

  it("writes status-scoped response examples JSON for the dedicated fixture through the real CLI path", async () => {
    const tempDirectory = await tempDir("rivet-ts-response-examples-cli-");
    const outputPath = path.join(tempDirectory, "response-examples-contract.json");
    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      fixturePath("response-examples-contract", "contracts.ts"),
      "--out",
      outputPath,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = parseContractJson(fileContents);

    expectValidContractDocument(payload);

    expect(payload.endpoints.map((endpoint) => endpoint.name).sort()).toEqual([
      "create",
      "legacyCreate",
    ]);

    const create = payload.endpoints.find((endpoint) => endpoint.name === "create");
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

    const legacy = payload.endpoints.find((endpoint) => endpoint.name === "legacyCreate");
    const legacy201 = legacy?.responses.find((r) => r.statusCode === 201);
    expect(legacy201?.examples).toEqual([
      {
        mediaType: "application/json",
        json: JSON.stringify({ id: "mem_legacy", email: "legacy@example.com" }),
      },
    ]);

    expect(payload.endpoints.every((endpoint) => !("successResponseExample" in endpoint))).toBe(
      true,
    );
  });

  it("writes named inline and ref-backed request examples through the real CLI path", async () => {
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
    const tempDirectory = path.dirname(entryPath);
    const outputPath = path.join(tempDirectory, "contract.json");
    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      entryPath,
      "--out",
      outputPath,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = parseContractJson(fileContents);

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
      "rivet-ts-invalid-request-example-descriptor-cli-",
    );
    const tempDirectory = path.dirname(entryPath);
    const outputPath = path.join(tempDirectory, "contract.json");
    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      entryPath,
      "--out",
      outputPath,
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(0);
    const requestExampleDiagnostics = stderr
      .split("\n")
      .filter((line) => line.includes("[INVALID_ENDPOINT_EXAMPLE_REFERENCE]"));
    expect(requestExampleDiagnostics).toHaveLength(1);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = parseContractJson(fileContents);
    expect(payload.endpoints.find((endpoint) => endpoint.name === "create")).not.toHaveProperty(
      "requestExamples",
    );
  });

  it("reports invalid security helper usage through the real CLI path", async () => {
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
      "rivet-ts-invalid-security-",
    );
    const tempDirectory = path.dirname(entryPath);
    const outputPath = path.join(tempDirectory, "contract.json");
    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      entryPath,
      "--out",
      outputPath,
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(0);
    const invalidSecurityDiagnostics = stderr
      .split("\n")
      .filter((line) => line.includes("[INVALID_SECURITY_SPEC]"));
    expect(invalidSecurityDiagnostics).toHaveLength(1);
    expect(invalidSecurityDiagnostics[0]).toContain("security.scheme as a string literal");
  });

  it("reports contradictory anonymous and security metadata through the real CLI path", async () => {
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
      "rivet-ts-conflicting-cli-",
    );
    const tempDirectory = path.dirname(entryPath);
    const outputPath = path.join(tempDirectory, "contract.json");
    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      entryPath,
      "--out",
      outputPath,
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(0);
    const conflictingSecurityDiagnostics = stderr
      .split("\n")
      .filter((line) => line.includes("[CONFLICTING_SECURITY_SPEC]"));
    expect(conflictingSecurityDiagnostics).toHaveLength(1);
    expect(conflictingSecurityDiagnostics[0]).toContain(
      "cannot declare both anonymous and security",
    );
  });

  it("propagates malformed endpoint example diagnostics through the real CLI path", async () => {
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
      "rivet-ts-invalid-example-cli-",
    );
    const tempDirectory = path.dirname(entryPath);
    const outputPath = path.join(tempDirectory, "contract.json");
    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      entryPath,
      "--out",
      outputPath,
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(0);
    const exampleDiagnostics = stderr
      .split("\n")
      .filter((line) => line.includes("[UNSUPPORTED_ENDPOINT_EXAMPLE_VALUE]"));
    expect(exampleDiagnostics).toHaveLength(1);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = parseContractJson(fileContents);
    expect(payload.endpoints.find((endpoint) => endpoint.name === "create")).not.toHaveProperty(
      "requestExamples",
    );
  });

  it("emits shorthand-property endpoint examples through the real CLI path", async () => {
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
      "rivet-ts-shorthand-example-cli-",
    );
    const tempDirectory = path.dirname(entryPath);
    const outputPath = path.join(tempDirectory, "contract.json");
    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      entryPath,
      "--out",
      outputPath,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = parseContractJson(fileContents);

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
        "rivet-ts-invalid-errors-",
      );
      const tempDirectory = path.dirname(entryPath);
      const outputPath = path.join(tempDirectory, "contract.json");
      const { exitCode, stdout, stderr } = await runCliCaptured([
        "--entry",
        entryPath,
        "--out",
        outputPath,
      ]);

      expect(exitCode).toBe(1);
      expect(stdout).toHaveLength(0);
      const errorDiagnostics = stderr
        .split("\n")
        .filter((line) => line.includes(`[${expectedCode}]`));
      expect(errorDiagnostics.length).toBeGreaterThan(0);

      const fileContents = await fs.readFile(outputPath, "utf8");
      const payload = parseContractJson(fileContents);
      const createEndpoint = payload.endpoints.find((endpoint) => endpoint.name === "create");

      expect(createEndpoint?.responses).toEqual([expect.objectContaining({ statusCode: 201 })]);
    },
  );

  it("supports the documented installed-consumer package import and CLI bin path", async () => {
    const packDirectory = await tempDir("rivet-ts-pack-");
    const consumerDirectory = await tempDir("rivet-ts-consumer-");
    const { stdout: packStdout } = await execFileAsync(
      "pnpm",
      ["pack", "--pack-destination", packDirectory],
      {
        cwd: PROJECT_ROOT,
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
        },
        null,
        2,
      ),
      "utf8",
    );

    // pnpm >= 11 reads overrides from pnpm-workspace.yaml, not the package.json
    // "pnpm" field. Link the heavyweight deps from this repo's node_modules so
    // the install stays fast and works without registry metadata for them.
    await fs.writeFile(
      path.join(consumerDirectory, "pnpm-workspace.yaml"),
      [
        "overrides:",
        `  typescript: "file:${path.join(PROJECT_ROOT, "node_modules", "typescript")}"`,
        `  tar: "file:${path.join(PROJECT_ROOT, "node_modules", "tar")}"`,
        "",
      ].join("\n"),
      "utf8",
    );

    await execFileAsync("pnpm", ["install", "--prefer-offline"], {
      cwd: consumerDirectory,
    });

    // P1 pin: the consumer install has no hono (optional peer dep). A bare runtime
    // import of the root entry must not crash by dragging dist/hono.js in.
    const { stdout: bareImportStdout } = await execFileAsync(
      "node",
      [
        "-e",
        'import("rivet-ts").then((mod) => { if (typeof mod.runCli !== "function") { throw new Error("runCli missing from root entry"); } console.log("bare-import-ok"); })',
      ],
      {
        cwd: consumerDirectory,
      },
    );
    expect(bareImportStdout).toContain("bare-import-ok");

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

    const payload = parseContractJson(
      await fs.readFile(path.join(consumerDirectory, "contract.json"), "utf8"),
    );

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
    const tempDirectory = await tempDir("rivet-ts-form-encoded-");
    const outputPath = path.join(tempDirectory, "form-encoded-contract.json");
    const { exitCode, stderr } = await runCliCaptured([
      "--entry",
      fixturePath("form-encoded-contract", "contracts.ts"),
      "--out",
      outputPath,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = parseContractJson(fileContents);

    expectValidContractDocument(payload);

    expect(payload.endpoints).toHaveLength(1);
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
    const tempDirectory = await tempDir("rivet-ts-multipart-");
    const outputPath = path.join(tempDirectory, "multipart-contract.json");
    const { exitCode, stderr } = await runCliCaptured([
      "--entry",
      fixturePath("multipart-contract", "contracts.ts"),
      "--out",
      outputPath,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = parseContractJson(fileContents);

    expectValidContractDocument(payload);

    expect(payload.endpoints).toHaveLength(1);
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

describe("CLI argument handling and diagnostics", () => {
  // C2: --help and --version exit 0 with output on stdout.
  it("prints usage for --help with exit code 0, covering every subcommand", async () => {
    const { exitCode, stdout, stderr } = await runCliCaptured(["--help"]);

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    const usage = stdout;
    expect(usage).toContain("Usage");
    expect(usage).toContain("rivet-ts --entry");
    expect(usage).toContain("scaffold-mock");
    expect(usage).toContain("generate --generated-root");
  });

  it("prints the package version for --version with exit code 0", async () => {
    const { version } = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf8"),
    ) as { version: string };

    const { exitCode, stdout, stderr } = await runCliCaptured(["--version"]);

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout).toContain(version);
  });

  // C3: unknown flags are loud errors, not silent no-ops.
  it("fails loudly on an unknown flag instead of silently ignoring it", async () => {
    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      fixturePath("members-contract", "contracts.ts"),
      "--tsconfg",
      "tsconfig.json",
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(0);
    expect(stderr).toContain("Unknown argument");
    expect(stderr).toContain("--tsconfg");
  });

  it("fails loudly on an unknown scaffold-mock flag", async () => {
    const { exitCode, stderr } = await runCliCaptured([
      "scaffold-mock",
      "--entry",
      "x.ts",
      "--out",
      "out",
      "--nme",
      "demo",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown argument");
    expect(stderr).toContain("--nme");
  });

  // C3: a flag missing its value is a loud error, not a silent redirect.
  it("fails loudly when --out is missing its value", async () => {
    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      fixturePath("members-contract", "contracts.ts"),
      "--out",
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(0);
    expect(stderr).toContain("--out");
    expect(stderr).toContain("missing a value");
  });

  it("lowers with the tsconfig passed via --tsconfig", async () => {
    const entryPath = await writeContractProject(
      {
        "models/member.ts": "export interface MemberDto { id: string }\n",
        "contracts.ts": `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";
import type { MemberDto } from "@models/member";

export interface MembersContract extends Contract<"MembersContract"> {
  List: Endpoint<{ method: "GET"; route: "/api/members"; response: MemberDto[] }>;
}
`,
        "tsconfig.contracts.json": JSON.stringify({
          compilerOptions: {
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            paths: { "@models/*": ["./models/*"] },
          },
        }),
      },
      "rivet-ts-lower-tsconfig-",
    );
    const tsconfigPath = path.join(path.dirname(entryPath), "tsconfig.contracts.json");

    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      entryPath,
      "--tsconfig",
      tsconfigPath,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const payload = parseContractJson(stdout);
    expect(payload.types.map((type) => type.name)).toEqual(["MemberDto"]);
  });

  // C1: --out into a directory that does not exist yet creates it.
  it("creates missing parent directories for --out", async () => {
    const tempDirectory = await tempDir("rivet-ts-out-create-");
    const outputPath = path.join(tempDirectory, "deeply", "nested", "contract.json");

    const { exitCode, stderr } = await runCliCaptured([
      "--entry",
      fixturePath("members-contract", "contracts.ts"),
      "--out",
      outputPath,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);

    const payload = parseContractJson(await fs.readFile(outputPath, "utf8"));
    expect(payload.endpoints.length).toBeGreaterThan(0);
  });

  // C4: an entry that defines no contracts produces a loud warning diagnostic,
  // not silent empty output.
  it("warns on stderr when the entry contains no contracts", async () => {
    const tempDirectory = await tempDir("rivet-ts-no-contracts-");
    const entryPath = path.join(tempDirectory, "contracts.ts");
    await fs.writeFile(entryPath, "export interface NotAContract { id: string }\n", "utf8");

    const { exitCode, stderr } = await runCliCaptured(["--entry", entryPath]);

    expect(exitCode).toBe(0);
    const warningLines = stderr.split("\n").filter((line) => line.includes("[ENTRY_NO_CONTRACTS]"));
    expect(warningLines).toHaveLength(1);
    expect(warningLines[0]).toContain("warning");
    expect(warningLines[0]).toContain(entryPath);
    expect(warningLines[0]).toContain("contains no contracts");
  });

  // C4/V3 root cause: a missing entry must be reported exactly once, not by
  // both the frontend and the lowerer.
  it("reports a missing entry exactly once", async () => {
    const { exitCode, stderr } = await runCliCaptured([
      "--entry",
      "/definitely/does/not/exist/contracts.ts",
    ]);

    expect(exitCode).toBe(1);
    const entryNotFoundLines = stderr
      .split("\n")
      .filter((line) => line.includes("[ENTRY_NOT_FOUND]"));
    expect(entryNotFoundLines).toHaveLength(1);
  });
});

describe("rivet passthrough", () => {
  const FAKE_RIVET_VERSION = "0.0.0-fake";
  const RIDS: Record<string, string> = {
    "darwin-arm64": "osx-arm64",
    "darwin-x64": "osx-x64",
    "linux-x64": "linux-x64",
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Seeds the real binary cache (under a throwaway HOME) so the passthrough
  // resolves the fake exactly as it would a downloaded Rivet release.
  const installFakeRivet = async (source: string): Promise<void> => {
    const home = await tempDir("rivet-ts-passthrough-");
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CACHE_HOME", path.join(home, ".cache"));
    vi.stubEnv("RIVET_VERSION", FAKE_RIVET_VERSION);

    const rid = RIDS[`${process.platform}-${process.arch}`];
    if (!rid) {
      throw new Error(`No Rivet rid for ${process.platform}-${process.arch}.`);
    }
    const cacheRoot =
      process.platform === "darwin"
        ? path.join(home, "Library", "Caches", "rivet-ts")
        : path.join(home, ".cache", "rivet-ts");
    const installDirectory = path.join(cacheRoot, "rivet", `v${FAKE_RIVET_VERSION}`, rid);
    const executablePath = path.join(installDirectory, `rivet-${rid}`);
    await fs.mkdir(installDirectory, { recursive: true });
    await fs.writeFile(executablePath, `#!/usr/bin/env node\n${source}\n`);
    await fs.chmod(executablePath, 0o755);
  };

  it("streams more than 1 MB of Rivet output and keeps its exit code", async () => {
    const size = 2 * 1024 * 1024;
    await installFakeRivet(`process.stdout.write("x".repeat(${size}));`);

    const { exitCode, stdout, stderr } = await runCliCaptured(["rivet", "--from", "contract.json"]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(size);
  });

  it("passes --help and --version after the subcommand to the Rivet binary", async () => {
    await installFakeRivet('console.log(`fake-rivet ${process.argv.slice(2).join(" ")}`);');

    expect(await runCliCaptured(["rivet", "--", "--version"])).toEqual({
      exitCode: 0,
      stdout: "fake-rivet --version\n",
      stderr: "",
    });
    expect((await runCliCaptured(["rivet", "--help"])).stdout).toBe("fake-rivet --help\n");
  });

  it("reports a Rivet binary killed by a signal as 128 + the signal number", async () => {
    await installFakeRivet('process.kill(process.pid, "SIGTERM");');

    const { exitCode } = await runCliCaptured(["rivet"]);

    expect(exitCode).toBe(128 + os.constants.signals.SIGTERM);
  });

  it("forwards a non-zero Rivet exit code", async () => {
    await installFakeRivet('process.stderr.write("RIV1102: refused\\n"); process.exitCode = 3;');

    expect(await runCliCaptured(["rivet", "--from", "contract.json"])).toEqual({
      exitCode: 3,
      stdout: "",
      stderr: "RIV1102: refused\n",
    });
  });
});
