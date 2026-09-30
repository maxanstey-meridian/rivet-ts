import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveRivetBinaryConfig } from "../../src/config/rivet-binary.js";
import { bearerSecurityArguments } from "../../src/infrastructure/rivet/security-arguments.js";
import { ensureRivetBinary } from "../../src/infrastructure/vite/rivet-binary.js";
import { type ContractJson, lowerFixture } from "../support/lower.js";
import { PROJECT_ROOT, fixturePath } from "../support/paths.js";
import { tempDir } from "../support/temp.js";

const execFileAsync = promisify(execFile);

// The pinned Rivet release, resolved and cached exactly as `rivet-ts rivet` and
// the Vite plugin resolve it.
const rivetConfig = resolveRivetBinaryConfig();
let rivetBinary: string;

beforeAll(async () => {
  rivetBinary = await ensureRivetBinary(rivetConfig);
});

// These fixtures exist to fail lowering; every other fixture must lower cleanly
// and be accepted by the pinned Rivet release.
const LOWERING_FAILURE_FIXTURES = [
  "invalid-authoring-contract",
  "invalid-tagged-union-contract",
  "unsupported-contract",
];

const lowerableFixtures = (await fs.readdir(fixturePath())).filter(
  (name) =>
    !LOWERING_FAILURE_FIXTURES.includes(name) && existsSync(fixturePath(name, "contracts.ts")),
);

// rivet-ts drops multipart input types from the contract's type definitions,
// so Rivet builds the multipart schema inline and says so (RIV2004).
const MULTIPART_INLINE_WARNING = /^warning RIV2004: multipart input type /u;

type OpenApiOperation = {
  readonly responses?: Record<
    string,
    { readonly content?: Record<string, { readonly schema?: { readonly $ref?: string } }> }
  >;
};

type OpenApiDocument = {
  readonly paths: Record<string, Record<string, OpenApiOperation>>;
  readonly components?: {
    readonly schemas?: Record<string, unknown>;
    readonly examples?: Record<string, unknown>;
  };
};

/** Lowers a fixture and runs the pinned `rivet --from` on it; returns the emitted OpenAPI. */
const emitOpenApi = async (
  fixture: string,
): Promise<{ readonly contract: ContractJson; readonly openApi: OpenApiDocument }> => {
  const { lowered, document } = lowerFixture(fixture);
  expect(lowered.diagnostics).toEqual([]);
  const outputDirectory = await tempDir("rivet-ts-rivet-from-");
  const contractPath = path.join(outputDirectory, "contract.json");
  await fs.writeFile(contractPath, `${lowered.toJson()}\n`);

  const { stderr } = await execFileAsync(rivetBinary, [
    "--from",
    contractPath,
    "--output",
    outputDirectory,
    "--openapi",
    "openapi.json",
    ...bearerSecurityArguments(lowered.document),
  ]);

  const unexpectedStderr = stderr
    .split("\n")
    .filter((line) => line.trim() !== "" && !MULTIPART_INLINE_WARNING.test(line));
  expect(unexpectedStderr).toEqual([]);
  const openApi = JSON.parse(
    await fs.readFile(path.join(outputDirectory, "openapi.json"), "utf8"),
  ) as OpenApiDocument;
  return { contract: document, openApi };
};

describe(`pinned Rivet release (v${rivetConfig.version})`, () => {
  it("ships the contract JSON schema vendored in tests/rivet-contract-schema.json", async () => {
    const response = await fetch(
      `https://raw.githubusercontent.com/maxanstey-meridian/rivet/v${rivetConfig.version}/rivet-contract-schema.json`,
    );
    expect(response.status).toBe(200);

    await expect(
      fs.readFile(path.join(PROJECT_ROOT, "tests", "rivet-contract-schema.json"), "utf8"),
    ).resolves.toBe(await response.text());
  });

  it.each(lowerableFixtures)(
    "emits an OpenAPI operation for every endpoint of %s via --from",
    async (fixture) => {
      const { contract, openApi } = await emitOpenApi(fixture);

      for (const endpoint of contract.endpoints) {
        expect(
          openApi.paths[endpoint.routeTemplate]?.[endpoint.httpMethod.toLowerCase()],
          `${endpoint.httpMethod} ${endpoint.routeTemplate}`,
        ).toBeDefined();
      }
    },
  );

  it("carries examples, media types, optionality and query auth into the OpenAPI", async () => {
    const { contract, openApi } = await emitOpenApi("openapi-smoke-contract");
    const json = { "application/json": expect.anything() };

    expect(openApi.paths["/api/items"]?.["post"]).toMatchObject({
      requestBody: {
        content: {
          "application/json": {
            examples: {
              "reviewer payload": expect.anything(),
              "component-backed": { $ref: "#/components/examples/CreateItemExample" },
            },
          },
        },
      },
      responses: { 201: { content: json }, 422: { content: json } },
    });
    expect(openApi.components?.examples?.["CreateItemExample"]).toBeDefined();
    expect(openApi.paths["/api/forms"]?.["post"]).toMatchObject({
      requestBody: { content: { "application/x-www-form-urlencoded": expect.anything() } },
    });
    expect(openApi.paths["/api/documents/{documentId}/upload"]?.["put"]).toMatchObject({
      requestBody: { content: { "multipart/form-data": expect.anything() } },
    });
    expect(openApi.paths["/api/items/{id}"]?.["delete"]).toMatchObject({
      responses: { 204: expect.not.objectContaining({ content: expect.anything() }) },
    });
    expect(openApi.paths["/api/items/export"]?.["get"]).toMatchObject({
      responses: { 200: { content: { "text/csv": expect.anything() } }, 422: { content: json } },
    });

    // Optionality is independent of nullability for inline response properties.
    const schemaRef =
      openApi.paths["/api/inline-shape"]?.["get"]?.responses?.["200"]?.content?.["application/json"]
        ?.schema?.$ref ?? "";
    const schemaPrefix = "#/components/schemas/";
    expect(schemaRef).toMatch(new RegExp(`^${schemaPrefix}`, "u"));
    expect(openApi.components?.schemas?.[schemaRef.slice(schemaPrefix.length)]).toMatchObject({
      required: ["required", "requiredNullable"],
      properties: {
        optional: expect.anything(),
        requiredNullable: { type: ["string", "null"] },
      },
    });

    // The contract JSON's isOptional and queryAuth survive --from.
    expect(contract.endpoints.find((endpoint) => endpoint.name === "searchItems")).toMatchObject({
      params: [
        expect.objectContaining({ name: "search", source: "query", isOptional: true }),
        expect.objectContaining({ name: "limit", source: "query", isOptional: false }),
      ],
      queryAuth: { parameterName: "api_key" },
    });
    expect(openApi.paths["/api/items/search"]?.["get"]).toMatchObject({
      parameters: [
        expect.objectContaining({ name: "search", in: "query", required: false }),
        expect.objectContaining({ name: "limit", in: "query", required: true }),
        expect.objectContaining({ name: "api_key", in: "query", required: true }),
      ],
      "x-rivet-query-auth": { parameterName: "api_key" },
    });
  });
});
