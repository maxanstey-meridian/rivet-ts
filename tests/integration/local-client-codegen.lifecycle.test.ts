import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { HandlerGroup } from "../../src/domain/handler-group.js";
import { BuildLocalConfig } from "../../src/domain/build-local-config.js";
import { BuildLocalPackage } from "../../src/application/use-cases/build-local-package.js";
import { TypeScriptHandlerEntrypointFrontend } from "../../src/infrastructure/typescript/typescript-handler-entrypoint-frontend.js";
import { TypeScriptContractFrontend } from "../../src/infrastructure/typescript/typescript-contract-frontend.js";
import { TypeScriptRivetContractLowerer } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { LocalClientCodegen, deriveClientName } from "../../src/infrastructure/codegen/local-client-codegen.js";
import type { RivetContractDocument } from "../../src/domain/rivet-contract.js";

const execFileAsync = promisify(execFile);

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

const tscPath = path.resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "node_modules",
  ".bin",
  "tsc",
);

const tscValidate = async (source: string, prefix: string): Promise<void> => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `rivet-codegen-${prefix}-`));
  const tmpFile = path.join(tmpDir, "emitted.d.ts");
  await fs.writeFile(tmpFile, source, "utf8");

  try {
    await execFileAsync(tscPath, [
      "--noEmit",
      "--strict",
      "--target",
      "ES2020",
      "--module",
      "ES2020",
      "--ignoreConfig",
      tmpFile,
    ]);
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    throw new Error(`tsc failed:\n${err.stdout ?? ""}\n${err.stderr ?? ""}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true });
  }
};

// Build the lowered contract documents from the fixture
const getPetContractDocument = async (): Promise<{
  handlerGroups: readonly HandlerGroup[];
  contractDocuments: Map<string, RivetContractDocument>;
}> => {
  const handlerFrontend = new TypeScriptHandlerEntrypointFrontend();
  const contractFrontend = new TypeScriptContractFrontend();
  const lowerer = new TypeScriptRivetContractLowerer();
  const useCase = new BuildLocalPackage(handlerFrontend, contractFrontend, lowerer);

  const config = new BuildLocalConfig({
    entryPath: getFixturePath("handler-entrypoint/index.ts"),
    target: "browser",
    packageName: "@test/pkg",
    outDir: "/tmp/test-out",
  });
  const result = await useCase.execute(config);
  expect(result.hasErrors).toBe(false);
  return {
    handlerGroups: result.handlerGroups,
    contractDocuments: result.contractDocuments,
  };
};

describe("deriveClientName", () => {
  it("strips Handlers suffix", () => {
    expect(deriveClientName("petHandlers")).toBe("pet");
  });

  it("strips handlers suffix", () => {
    expect(deriveClientName("summaryhandlers")).toBe("summary");
  });

  it("keeps name unchanged without suffix", () => {
    expect(deriveClientName("myClient")).toBe("myClient");
  });
});

describe("LocalClientCodegen", () => {
  const codegen = new LocalClientCodegen();

  it("generates JS with correct import/export structure", async () => {
    const { handlerGroups, contractDocuments } = await getPetContractDocument();
    const petGroup = handlerGroups.find((g) => g.exportName === "petHandlers")!;
    const petDoc = contractDocuments.get("PetContract")!;

    const result = codegen.generate(petGroup, petDoc);

    expect(result.clientName).toBe("pet");
    expect(result.handlerGroupExportName).toBe("petHandlers");

    // Verify JS source structure
    expect(result.jsSource).toContain("import { createDirectClient } from '../runtime/rivet-runtime.js'");
    expect(result.jsSource).toContain("import { petHandlers } from '../runtime/handlers.js'");
    expect(result.jsSource).toContain("export const pet = createDirectClient(petHandlers)");
  });

  it("generates JS with correct structure for summary handler group", async () => {
    const { handlerGroups, contractDocuments } = await getPetContractDocument();
    const summaryGroup = handlerGroups.find((g) => g.exportName === "summaryHandlers")!;
    const summaryDoc = contractDocuments.get("SummaryContract")!;

    const result = codegen.generate(summaryGroup, summaryDoc);

    expect(result.clientName).toBe("summary");
    expect(result.jsSource).toContain("import { summaryHandlers } from '../runtime/handlers.js'");
    expect(result.jsSource).toContain("export const summary = createDirectClient(summaryHandlers)");
  });

  it("generates DTS that type-checks with tsc", async () => {
    const { handlerGroups, contractDocuments } = await getPetContractDocument();
    const petGroup = handlerGroups.find((g) => g.exportName === "petHandlers")!;
    const petDoc = contractDocuments.get("PetContract")!;

    const result = codegen.generate(petGroup, petDoc);

    // DTS should contain the DTO types
    expect(result.dtsSource).toContain("PetDto");
    expect(result.dtsSource).toContain("CreatePetRequest");

    // DTS should contain the client interface
    expect(result.dtsSource).toContain("PetContractClient");
    expect(result.dtsSource).toContain("export declare const pet");

    // DTS should contain method signatures for each endpoint
    expect(result.dtsSource).toContain("ListPets");
    expect(result.dtsSource).toContain("CreatePet");

    // Verify it type-checks
    await tscValidate(result.dtsSource, "pet-client");
  });

  it("generates DTS with unwrap: false overloads", async () => {
    const { handlerGroups, contractDocuments } = await getPetContractDocument();
    const petGroup = handlerGroups.find((g) => g.exportName === "petHandlers")!;
    const petDoc = contractDocuments.get("PetContract")!;

    const result = codegen.generate(petGroup, petDoc);

    // Should have unwrap: false overloads
    expect(result.dtsSource).toContain("unwrap: false");
  });

  it("generates DTS for summary contract that type-checks", async () => {
    const { handlerGroups, contractDocuments } = await getPetContractDocument();
    const summaryGroup = handlerGroups.find((g) => g.exportName === "summaryHandlers")!;
    const summaryDoc = contractDocuments.get("SummaryContract")!;

    const result = codegen.generate(summaryGroup, summaryDoc);

    expect(result.dtsSource).toContain("SummaryDto");
    expect(result.dtsSource).toContain("SummaryContractClient");
    expect(result.dtsSource).toContain("GetSummary");

    await tscValidate(result.dtsSource, "summary-client");
  });

  it("generates DTS with correct input and return types for endpoints", async () => {
    const { handlerGroups, contractDocuments } = await getPetContractDocument();
    const petGroup = handlerGroups.find((g) => g.exportName === "petHandlers")!;
    const petDoc = contractDocuments.get("PetContract")!;

    const result = codegen.generate(petGroup, petDoc);

    // ListPets: no input, returns PetDto[]
    expect(result.dtsSource).toMatch(/ListPets\(\): Promise<PetDto\[\]>/);

    // CreatePet: has input, returns PetDto
    expect(result.dtsSource).toMatch(/CreatePet\(input: CreatePetRequest\): Promise<PetDto>/);
  });

  it("includes success status in unwrap: false return type", async () => {
    const { handlerGroups, contractDocuments } = await getPetContractDocument();
    const petGroup = handlerGroups.find((g) => g.exportName === "petHandlers")!;
    const petDoc = contractDocuments.get("PetContract")!;

    const result = codegen.generate(petGroup, petDoc);

    // CreatePet has successStatus 201
    expect(result.dtsSource).toContain("readonly status: 201");

    // ListPets has default successStatus 200
    expect(result.dtsSource).toContain("readonly status: 200");
  });

  it("throws when handler group endpoint is not found in contract document", async () => {
    const { contractDocuments } = await getPetContractDocument();
    const petDoc = contractDocuments.get("PetContract")!;

    const mismatchedGroup = new HandlerGroup({
      exportName: "petHandlers",
      contractName: "PetContract",
      contractSourcePath: "/fake/pet-contract.ts",
      handlerSourcePath: "/fake/pet.handlers.ts",
      endpointNames: ["ListPets", "NonExistentEndpoint"],
    });

    expect(() => codegen.generate(mismatchedGroup, petDoc)).toThrow(
      "Endpoint 'NonExistentEndpoint' from handler group 'petHandlers' not found in contract document",
    );
  });
});
