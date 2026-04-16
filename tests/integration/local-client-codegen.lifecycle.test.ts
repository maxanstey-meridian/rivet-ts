import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HandlerGroup } from "../../src/domain/handler-group.js";
import { BuildLocalConfig } from "../../src/domain/build-local-config.js";
import { BuildLocalPackage } from "../../src/application/use-cases/build-local-package.js";
import { TypeScriptHandlerEntrypointFrontend } from "../../src/infrastructure/typescript/typescript-handler-entrypoint-frontend.js";
import { TypeScriptContractFrontend } from "../../src/infrastructure/typescript/typescript-contract-frontend.js";
import { TypeScriptRivetContractLowerer } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { LocalClientCodegen, deriveClientName } from "../../src/infrastructure/codegen/local-client-codegen.js";
import { EsbuildImplementationBundler } from "../../src/infrastructure/bundler/esbuild-implementation-bundler.js";
import { LocalPackageEmitter } from "../../src/infrastructure/package/local-package-emitter.js";
import {
  RivetContractDocument,
  RivetEndpointDefinition,
  RivetEndpointParam,
  RivetResponseType,
  RivetTypeDefinition,
} from "../../src/domain/rivet-contract.js";

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

// Build the lowered contract documents from the fixture
const getPetContractDocument = async (): Promise<{
  handlerGroups: readonly HandlerGroup[];
  contractDocuments: Map<string, RivetContractDocument>;
}> => {
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

  const tmpOutDir = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-codegen-build-"));
  try {
    const config = new BuildLocalConfig({
      entryPath: getFixturePath("handler-entrypoint/index.ts"),
      target: "browser",
      packageName: "@test/pkg",
      outDir: path.join(tmpOutDir, "out"),
    });
    const result = await useCase.execute(config);
    expect(result.hasErrors).toBe(false);
    return {
      handlerGroups: result.handlerGroups,
      contractDocuments: result.contractDocuments,
    };
  } finally {
    await fs.rm(tmpOutDir, { recursive: true, force: true });
  }
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
    expect(result.jsSource).toContain('import "../runtime/index.js"');
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

  it("generates DTS that imports and re-exports shared types", async () => {
    const { handlerGroups, contractDocuments } = await getPetContractDocument();
    const petGroup = handlerGroups.find((g) => g.exportName === "petHandlers")!;
    const petDoc = contractDocuments.get("PetContract")!;

    const result = codegen.generate(petGroup, petDoc);

    expect(result.dtsSource).toContain(`import type { CreatePetRequest, PetDto } from "../types/index.js";`);
    expect(result.dtsSource).toContain(`export type { CreatePetRequest, PetDto } from "../types/index.js";`);
    expect(result.dtsSource).toContain("PetContractClient");
    expect(result.dtsSource).toContain("export declare const pet");
    expect(result.dtsSource).toContain("ListPets");
    expect(result.dtsSource).toContain("CreatePet");
  });

  it("generates DTS with unwrap: false overloads", async () => {
    const { handlerGroups, contractDocuments } = await getPetContractDocument();
    const petGroup = handlerGroups.find((g) => g.exportName === "petHandlers")!;
    const petDoc = contractDocuments.get("PetContract")!;

    const result = codegen.generate(petGroup, petDoc);

    // Should have unwrap: false overloads
    expect(result.dtsSource).toContain("unwrap: false");
  });

  it("generates DTS for summary contract using shared types", async () => {
    const { handlerGroups, contractDocuments } = await getPetContractDocument();
    const summaryGroup = handlerGroups.find((g) => g.exportName === "summaryHandlers")!;
    const summaryDoc = contractDocuments.get("SummaryContract")!;

    const result = codegen.generate(summaryGroup, summaryDoc);

    expect(result.dtsSource).toContain(`import type { SummaryDto } from "../types/index.js";`);
    expect(result.dtsSource).toContain("SummaryContractClient");
    expect(result.dtsSource).toContain("GetSummary");
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

  it("emits unwrap: false overload before the default signature", async () => {
    const { handlerGroups, contractDocuments } = await getPetContractDocument();
    const petGroup = handlerGroups.find((g) => g.exportName === "petHandlers")!;
    const petDoc = contractDocuments.get("PetContract")!;

    const result = codegen.generate(petGroup, petDoc);

    const wrappedIndex = result.dtsSource.indexOf(
      'CreatePet(input: CreatePetRequest, options: { readonly unwrap: false })',
    );
    const defaultIndex = result.dtsSource.indexOf(
      "CreatePet(input: CreatePetRequest): Promise<PetDto>;",
    );

    expect(wrappedIndex).toBeGreaterThan(-1);
    expect(defaultIndex).toBeGreaterThan(-1);
    expect(wrappedIndex).toBeLessThan(defaultIndex);
  });

  it("generates DTS with error variant union in unwrap:false overload", async () => {
    const errorDoc = new RivetContractDocument({
      types: [
        new RivetTypeDefinition({
          name: "DivideRequest",
          properties: [
            { name: "dividend", type: { kind: "primitive", type: "number" }, optional: false },
            { name: "divisor", type: { kind: "primitive", type: "number" }, optional: false },
          ],
        }),
        new RivetTypeDefinition({
          name: "DivideResponse",
          properties: [
            { name: "quotient", type: { kind: "primitive", type: "number" }, optional: false },
          ],
        }),
        new RivetTypeDefinition({
          name: "ValidationError",
          properties: [
            { name: "message", type: { kind: "primitive", type: "string" }, optional: false },
          ],
        }),
      ],
      endpoints: [
        new RivetEndpointDefinition({
          name: "divide",
          httpMethod: "POST",
          routeTemplate: "/api/math/divide",
          controllerName: "math",
          params: [
            new RivetEndpointParam({
              name: "body",
              type: { kind: "ref", name: "DivideRequest" },
              source: "body",
            }),
          ],
          returnType: { kind: "ref", name: "DivideResponse" },
          responses: [
            new RivetResponseType({ statusCode: 200, dataType: { kind: "ref", name: "DivideResponse" } }),
            new RivetResponseType({ statusCode: 422, dataType: { kind: "ref", name: "ValidationError" } }),
          ],
        }),
      ],
    });

    const errorGroup = new HandlerGroup({
      exportName: "mathHandlers",
      contractName: "MathContract",
      contractSourcePath: "/fake/math-contract.ts",
      handlerSourcePath: "/fake/math.handlers.ts",
      endpointNames: ["Divide"],
    });

    const result = codegen.generate(errorGroup, errorDoc);

    // unwrap:false overload should include both success and error variants
    expect(result.dtsSource).toContain("readonly status: 200; readonly data: DivideResponse");
    expect(result.dtsSource).toContain("readonly status: 422; readonly data: ValidationError");

    // The union should join them with |
    expect(result.dtsSource).toMatch(
      /Promise<\{ readonly status: 200; readonly data: DivideResponse \} \| \{ readonly status: 422; readonly data: ValidationError \}>/,
    );

    // Default overload should still return just the success type
    expect(result.dtsSource).toMatch(/Divide\(input: DivideRequest\): Promise<DivideResponse>;/);

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
