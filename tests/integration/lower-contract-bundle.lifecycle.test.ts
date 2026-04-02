import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExtractTsContracts } from "../../src/application/use-cases/extract-ts-contracts.js";
import { LowerContractBundleToRivetContract } from "../../src/application/use-cases/lower-contract-bundle-to-rivet-contract.js";
import { TypeScriptContractFrontend } from "../../src/infrastructure/typescript/typescript-contract-frontend.js";
import { TypeScriptRivetContractLowerer } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

const readJsonFixture = async (relativePath: string): Promise<unknown> => {
  const fileContents = await fs.readFile(getFixturePath(relativePath), "utf8");
  return JSON.parse(fileContents) as unknown;
};

describe("LowerContractBundleToRivetContract lifecycle", () => {
  it("lowers an extracted contract bundle into Rivet contract JSON", async () => {
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);

    const bundle = await extractUseCase.execute({
      entryPath: getFixturePath(path.join("members-contract", "contracts.ts")),
    });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);

    const payload = JSON.parse(lowered.toJson()) as {
      endpoints: Array<{ name: string; controllerName: string }>;
    };
    expect(payload).toEqual(
      await readJsonFixture(path.join("members-contract", "golden-contract.json")),
    );
    expect(payload.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "invite", controllerName: "members" }),
        expect.objectContaining({ name: "updateRole", controllerName: "members" }),
      ]),
    );
  });
});
