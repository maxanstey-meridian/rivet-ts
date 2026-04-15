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

describe("Invalid tagged union contract lifecycle", () => {
  it("emits explicit diagnostics for unsupported discriminated union shapes", async () => {
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);

    const bundle = await extractUseCase.execute({
      entryPath: getFixturePath(path.join("invalid-tagged-union-contract", "contracts.ts")),
    });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(bundle.hasErrors).toBe(false);
    expect(lowered.hasErrors).toBe(true);

    const unionDiagnostics = lowered.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNSUPPORTED_UNION",
    );
    expect(unionDiagnostics).toHaveLength(6);

    expect(unionDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('repeats discriminator value "hidden"'),
        }),
        expect.objectContaining({
          message: expect.stringContaining(
            "cannot use optional properties in tagged union variants",
          ),
        }),
        expect.objectContaining({
          message: expect.stringContaining('state: "shown"'),
        }),
        expect.objectContaining({
          message: expect.stringContaining('| "shown"'),
        }),
      ]),
    );
  });
});
