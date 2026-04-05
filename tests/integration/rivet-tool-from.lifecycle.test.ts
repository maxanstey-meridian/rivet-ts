import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ExtractTsContracts } from "../../src/application/use-cases/extract-ts-contracts.js";
import { LowerContractBundleToRivetContract } from "../../src/application/use-cases/lower-contract-bundle-to-rivet-contract.js";
import { TypeScriptContractFrontend } from "../../src/infrastructure/typescript/typescript-contract-frontend.js";
import { TypeScriptRivetContractLowerer } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";

const execFileAsync = promisify(execFile);

const RIVET_TOOL_PROJECT = "/Users/max/Sites/medway/rivet/Rivet.Tool";

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

describe("Rivet.Tool --from OpenAPI smoke", () => {
  it("generates valid OpenAPI from TS-authored Rivet contract JSON", async () => {
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);

    const bundle = await extractUseCase.execute({
      entryPath: getFixturePath(path.join("openapi-smoke-contract", "contracts.ts")),
    });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(bundle.hasErrors).toBe(false);
    expect(lowered.hasErrors).toBe(false);

    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-openapi-smoke-"));
    const contractPath = path.join(tempDirectory, "contract.json");
    const openApiFileName = "openapi.json";

    await fs.writeFile(contractPath, `${lowered.toJson()}\n`, "utf8");

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

    expect(stderr).toBe("");

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
  }, 120000);
});
