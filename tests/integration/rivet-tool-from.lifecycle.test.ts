import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { LowerTsContractsToRivetContract } from "../../src/application/use-cases/lower-ts-contracts-to-rivet-contract.js";
import { TypeScriptRivetContractLowerer } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";

const execFileAsync = promisify(execFile);

const RIVET_TOOL_PROJECT =
  process.env["RIVET_DOTNET_TOOL_PATH"] ?? "/Users/max/Sites/medway/rivet/Rivet.Tool";

const rivetToolAvailable = existsSync(RIVET_TOOL_PROJECT);

if (!rivetToolAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    `[rivet-tool-from] Skipping .NET interop smoke test: Rivet.Tool project not found at "${RIVET_TOOL_PROJECT}". ` +
      "Set RIVET_DOTNET_TOOL_PATH to the Rivet.Tool project directory to enable it.",
  );
}

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

type OpenApiDoc = {
  paths: Record<
    string,
    Record<
      string,
      {
        operationId?: string;
        requestBody?: {
          content: Record<
            string,
            {
              schema?: Record<string, unknown>;
              example?: unknown;
              examples?: Record<string, unknown>;
            }
          >;
        };
        responses: Record<
          string,
          {
            description?: string;
            content?: Record<
              string,
              {
                schema?: Record<string, unknown>;
                example?: unknown;
                examples?: Record<string, unknown>;
              }
            >;
          }
        >;
      }
    >
  >;
  components?: {
    schemas?: Record<string, unknown>;
    examples?: Record<string, Record<string, unknown>>;
  };
};

describe.skipIf(!rivetToolAvailable)("Rivet.Tool --from OpenAPI smoke", () => {
  it("generates valid OpenAPI from TS-authored Rivet contract JSON", async () => {
    const lowerer = new TypeScriptRivetContractLowerer();
    const lowerUseCase = new LowerTsContractsToRivetContract(lowerer);

    const lowered = await lowerUseCase.execute({
      entryPath: getFixturePath(path.join("openapi-smoke-contract", "contracts.ts")),
    });

    expect(lowered.hasErrors).toBe(false);

    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-openapi-smoke-"));
    const contractPath = path.join(tempDirectory, "contract.json");
    const openApiFileName = "openapi.json";

    await fs.writeFile(contractPath, `${lowered.toJson()}\n`, "utf8");

    // The wire-format facts the .NET tool consumes: optional query params and
    // queryAuth must be present in the contract JSON handed to --from. The
    // fixture previously had neither — exactly how N1/N3 escaped this test.
    const wireContract = JSON.parse(await fs.readFile(contractPath, "utf8")) as {
      endpoints: Array<{
        name: string;
        params?: Array<{ name: string; source: string; isOptional: boolean }>;
        queryAuth?: { parameterName: string };
      }>;
    };
    const searchEndpoint = wireContract.endpoints.find(
      (endpoint) => endpoint.name === "searchItems",
    );
    expect(searchEndpoint).toBeDefined();
    expect(searchEndpoint!.params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "search", source: "query", isOptional: true }),
        expect.objectContaining({ name: "limit", source: "query", isOptional: false }),
      ]),
    );
    expect(searchEndpoint!.queryAuth).toEqual({ parameterName: "api_key" });

    const { stderr } = await execFileAsync(
      "dotnet",
      [
        "run",
        "--project",
        RIVET_TOOL_PROJECT,
        "--",
        "--from",
        contractPath,
        "--openapi",
        openApiFileName,
        "--output",
        tempDirectory,
      ],
      { timeout: 60000 },
    );

    // The tool's multipart inline-fallback warning is the .NET side of
    // FABLE_GAPS §3 BUG-2 (rivet-ts drops multipart input types from the
    // contract's type definitions). Tolerated until the TS lowerer emits the
    // type definition; anything else on stderr is still a failure.
    const unexpectedStderr = stderr
      .split("\n")
      .filter((line) => line.trim() !== "" && !/multipart input type .* inline/u.test(line));
    expect(unexpectedStderr).toEqual([]);

    const openApiPath = path.join(tempDirectory, openApiFileName);
    const openApiContents = await fs.readFile(openApiPath, "utf8");
    const openApi = JSON.parse(openApiContents) as OpenApiDoc;

    // --- Standard POST: plural request examples with named and ref-backed entries ---
    const createOp = openApi.paths["/api/items"]?.post;
    expect(createOp).toBeDefined();

    const createRequestContent = createOp!.requestBody?.content["application/json"];
    expect(createRequestContent).toBeDefined();
    expect(createRequestContent!.examples).toBeDefined();
    expect(createRequestContent!.examples!["reviewer payload"]).toBeDefined();

    // Ref-backed example appears as $ref in operation
    const componentBackedExample = createRequestContent!.examples!["component-backed"] as {
      $ref?: string;
    };
    expect(componentBackedExample?.$ref).toBe("#/components/examples/CreateItemExample");

    // Component examples section contains the ref-backed example
    expect(openApi.components?.examples?.["CreateItemExample"]).toBeDefined();

    // Status-scoped response examples
    const create201 = createOp!.responses["201"];
    expect(create201?.content?.["application/json"]).toBeDefined();

    const create422 = createOp!.responses["422"];
    expect(create422?.content?.["application/json"]).toBeDefined();

    // Inline properties preserve optionality independently from nullability.
    const inlineResponseSchema = openApi.paths["/api/inline-shape"]?.get?.responses["200"]
      ?.content?.["application/json"]?.schema as { $ref?: string } | undefined;
    const inlineComponentName = inlineResponseSchema?.$ref?.split("/").at(-1);
    const inlineResponse = (
      inlineComponentName
        ? openApi.components?.schemas?.[inlineComponentName]
        : inlineResponseSchema
    ) as
      | {
          required?: string[];
          properties?: Record<string, { type?: string | string[] }>;
        }
      | undefined;
    expect(inlineResponse?.required).toEqual(["required", "requiredNullable"]);
    expect(inlineResponse?.properties?.["optional"]).toBeDefined();
    expect(inlineResponse?.properties?.["requiredNullable"]?.type).toEqual(["string", "null"]);

    // --- Form-encoded POST: application/x-www-form-urlencoded ---
    const formOp = openApi.paths["/api/forms"]?.post;
    expect(formOp).toBeDefined();
    expect(formOp!.requestBody?.content["application/x-www-form-urlencoded"]).toBeDefined();

    // --- Multipart PUT: multipart/form-data ---
    const uploadOp = openApi.paths["/api/documents/{documentId}/upload"]?.put;
    expect(uploadOp).toBeDefined();
    expect(uploadOp!.requestBody?.content["multipart/form-data"]).toBeDefined();

    // --- DELETE 204: response example on void response ---
    const deleteOp = openApi.paths["/api/items/{id}"]?.delete;
    expect(deleteOp).toBeDefined();
    const delete204 = deleteOp!.responses["204"];
    expect(delete204).toBeDefined();
    expect(delete204?.content).toBeDefined();

    // --- File GET: success uses text/csv, error uses application/json ---
    const exportOp = openApi.paths["/api/items/export"]?.get;
    expect(exportOp).toBeDefined();

    const export200 = exportOp!.responses["200"];
    expect(export200?.content?.["text/csv"]).toBeDefined();

    const export422 = exportOp!.responses["422"];
    expect(export422?.content?.["application/json"]).toBeDefined();

    // --- GET with optional query param + queryAuth ---
    const searchOp = openApi.paths["/api/items/search"]?.get as
      | {
          parameters?: Array<{ name: string; in: string; required?: boolean }>;
          security?: unknown;
        }
      | undefined;
    expect(searchOp).toBeDefined();
    expect(searchOp!.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "search", in: "query" }),
        expect.objectContaining({ name: "limit", in: "query", required: true }),
      ]),
    );
    // TODO(N1, .NET side): the .NET JsonContractReader does not read
    // "isOptional" yet, so "search" is emitted as required: true. Once the
    // reader is fixed, tighten the assertion above to
    // objectContaining({ name: "search", in: "query", required: false }).
    //
    // TODO(N3, .NET side): the .NET JsonContractReader DROPS "queryAuth"
    // entirely on the --from path, so the emitted OpenAPI has no security
    // scheme for it. The contract JSON assertion earlier in this test pins the
    // rivet-ts side; once N3 is fixed, assert the queryAuth security/x-rivet
    // representation here.
  }, 120000);
});
