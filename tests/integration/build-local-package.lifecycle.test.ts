import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BuildLocalConfig } from "../../src/domain/build-local-config.js";
import { BuildLocalPackage } from "../../src/application/use-cases/build-local-package.js";
import { TypeScriptHandlerEntrypointFrontend } from "../../src/infrastructure/typescript/typescript-handler-entrypoint-frontend.js";
import { TypeScriptContractFrontend } from "../../src/infrastructure/typescript/typescript-contract-frontend.js";
import { TypeScriptRivetContractLowerer } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { LocalClientCodegen } from "../../src/infrastructure/codegen/local-client-codegen.js";
import { EsbuildImplementationBundler } from "../../src/infrastructure/bundler/esbuild-implementation-bundler.js";
import { LocalPackageEmitter } from "../../src/infrastructure/package/local-package-emitter.js";

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

describe("BuildLocalPackage lifecycle", () => {
  const handlerFrontend = new TypeScriptHandlerEntrypointFrontend();
  const contractFrontend = new TypeScriptContractFrontend();
  const lowerer = new TypeScriptRivetContractLowerer();
  const codegen = new LocalClientCodegen();
  const bundler = new EsbuildImplementationBundler();
  const emitter = new LocalPackageEmitter();
  const useCase = new BuildLocalPackage(
    handlerFrontend,
    contractFrontend,
    lowerer,
    codegen,
    bundler,
    emitter,
  );

  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-build-local-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const makeConfig = (entryPath: string): BuildLocalConfig =>
    new BuildLocalConfig({
      entryPath,
      target: "browser",
      packageName: "@test/pkg",
      outDir: path.join(tmpDir, "out"),
    });

  it("produces contract documents for both contracts in the fixture", async () => {
    const config = makeConfig(getFixturePath("handler-entrypoint/index.ts"));
    const result = await useCase.execute(config);

    expect(result.hasErrors).toBe(false);
    expect(result.contractDocuments.size).toBe(2);
    expect(result.contractDocuments.has("PetContract")).toBe(true);
    expect(result.contractDocuments.has("SummaryContract")).toBe(true);
  });

  it("each contract document has the expected endpoint names", async () => {
    const config = makeConfig(getFixturePath("handler-entrypoint/index.ts"));
    const result = await useCase.execute(config);

    const petDoc = result.contractDocuments.get("PetContract")!;
    const petEndpointNames = petDoc.endpoints.map((e) => e.name);
    expect(petEndpointNames).toHaveLength(2);
    expect(petEndpointNames).toEqual(expect.arrayContaining(["listPets", "createPet"]));

    const summaryDoc = result.contractDocuments.get("SummaryContract")!;
    const summaryEndpointNames = summaryDoc.endpoints.map((e) => e.name);
    expect(summaryEndpointNames).toEqual(["getSummary"]);
  });

  it("lowered endpoints have correct HTTP methods and routes", async () => {
    const config = makeConfig(getFixturePath("handler-entrypoint/index.ts"));
    const result = await useCase.execute(config);

    const petDoc = result.contractDocuments.get("PetContract")!;
    const listPets = petDoc.endpoints.find((e) => e.name === "listPets")!;
    expect(listPets.httpMethod).toBe("GET");
    expect(listPets.routeTemplate).toBe("/api/pets");

    const createPet = petDoc.endpoints.find((e) => e.name === "createPet")!;
    expect(createPet.httpMethod).toBe("POST");
    expect(createPet.routeTemplate).toBe("/api/pets");

    const summaryDoc = result.contractDocuments.get("SummaryContract")!;
    const getSummary = summaryDoc.endpoints.find((e) => e.name === "getSummary")!;
    expect(getSummary.httpMethod).toBe("GET");
    expect(getSummary.routeTemplate).toBe("/api/summary");
  });

  it("returns handler groups from discovery", async () => {
    const config = makeConfig(getFixturePath("handler-entrypoint/index.ts"));
    const result = await useCase.execute(config);

    expect(result.handlerGroups).toHaveLength(2);

    const exportNames = result.handlerGroups.map((g) => g.exportName).sort();
    expect(exportNames).toEqual(["petHandlers", "summaryHandlers"]);
  });

  it("diagnostics are empty for valid input", async () => {
    const config = makeConfig(getFixturePath("handler-entrypoint/index.ts"));
    const result = await useCase.execute(config);

    expect(result.diagnostics).toHaveLength(0);
  });

  it("propagates diagnostics from extraction errors and skips failed contracts", async () => {
    const config = makeConfig(
      getFixturePath("handler-entrypoint-extraction-error/index.ts"),
    );
    const result = await useCase.execute(config);

    // Discovery should succeed (finds the handler group)
    expect(result.handlerGroups).toHaveLength(1);
    expect(result.handlerGroups[0].contractName).toBe("BrokenContract");

    // Extraction should fail (broken import) — contract document should be absent
    expect(result.contractDocuments.size).toBe(0);

    // Diagnostics from extraction should propagate
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.hasErrors).toBe(true);
  });

  it("propagates diagnostics from discovery errors", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-build-"));
    try {
      const entryPath = path.join(tempDir, "index.ts");
      await fs.writeFile(entryPath, 'export const notHandlers = { foo: "bar" };\n');

      const config = makeConfig(entryPath);
      const result = await useCase.execute(config);

      expect(result.hasErrors).toBe(true);
      expect(result.contractDocuments.size).toBe(0);
      expect(result.handlerGroups).toHaveLength(0);
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "NOT_HANDLER_GROUP" }),
          expect.objectContaining({ code: "NO_HANDLER_GROUPS" }),
        ]),
      );
    } finally {
      await fs.rm(tempDir, { recursive: true });
    }
  });
});
