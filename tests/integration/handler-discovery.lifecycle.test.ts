import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TypeScriptHandlerEntrypointFrontend } from "../../src/infrastructure/typescript/typescript-handler-entrypoint-frontend.js";

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

describe("Handler discovery lifecycle", () => {
  const frontend = new TypeScriptHandlerEntrypointFrontend();

  it("discovers two handler groups from fixture entrypoint", async () => {
    const result = await frontend.discover(
      getFixturePath("handler-entrypoint/index.ts"),
    );

    expect(result.hasErrors).toBe(false);
    expect(result.handlerGroups).toHaveLength(2);

    const exportNames = result.handlerGroups.map((g) => g.exportName).sort();
    expect(exportNames).toEqual(["petHandlers", "summaryHandlers"]);
  });

  it("extracts correct contract names and endpoint names", async () => {
    const result = await frontend.discover(
      getFixturePath("handler-entrypoint/index.ts"),
    );

    const pet = result.handlerGroups.find((g) => g.exportName === "petHandlers")!;
    const summary = result.handlerGroups.find((g) => g.exportName === "summaryHandlers")!;

    expect(pet.contractName).toBe("PetContract");
    expect(pet.endpointNames).toHaveLength(2);
    expect(pet.endpointNames).toEqual(expect.arrayContaining(["ListPets", "CreatePet"]));

    expect(summary.contractName).toBe("SummaryContract");
    expect(summary.endpointNames).toEqual(["GetSummary"]);
  });

  it("resolves correct source paths for contracts and handlers", async () => {
    const result = await frontend.discover(
      getFixturePath("handler-entrypoint/index.ts"),
    );

    const pet = result.handlerGroups.find((g) => g.exportName === "petHandlers")!;
    const summary = result.handlerGroups.find((g) => g.exportName === "summaryHandlers")!;

    expect(pet.contractSourcePath).toContain("pet-contract.ts");
    expect(pet.handlerSourcePath).toContain("pet.handlers.ts");
    expect(summary.contractSourcePath).toContain("summary-contract.ts");
    expect(summary.handlerSourcePath).toContain("summary.handlers.ts");
  });

  it("produces diagnostic for non-defineHandlers exports", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-"));
    try {
      const entryPath = path.join(tempDir, "index.ts");
      await fs.writeFile(entryPath, 'export const notHandlers = { foo: "bar" };\n');

      const result = await frontend.discover(entryPath);

      expect(result.hasErrors).toBe(true);
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

  it("produces diagnostic for entrypoint with zero handler exports", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-"));
    try {
      const entryPath = path.join(tempDir, "empty.ts");
      await fs.writeFile(entryPath, "export {};\n");

      const result = await frontend.discover(entryPath);

      expect(result.hasErrors).toBe(true);
      expect(result.handlerGroups).toHaveLength(0);
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "NO_HANDLER_GROUPS" }),
        ]),
      );
    } finally {
      await fs.rm(tempDir, { recursive: true });
    }
  });

  it("silently ignores reserved local-package lifecycle exports", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-"));
    try {
      const entryPath = path.join(tempDir, "index.ts");
      await fs.writeFile(
        entryPath,
        [
          "export const disposeLocalApi = async (): Promise<void> => {};",
          "export const resetLocalApi = async (): Promise<void> => {};",
          "",
        ].join("\n"),
      );

      const result = await frontend.discover(entryPath);

      expect(result.handlerGroups).toHaveLength(0);
      expect(result.diagnostics).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "NOT_HANDLER_GROUP" }),
        ]),
      );
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "NO_HANDLER_GROUPS" }),
        ]),
      );
    } finally {
      await fs.rm(tempDir, { recursive: true });
    }
  });
});
