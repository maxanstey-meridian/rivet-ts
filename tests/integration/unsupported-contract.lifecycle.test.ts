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

describe("Unsupported contract lifecycle", () => {
  it("emits explicit diagnostics for unsupported TS constructs", async () => {
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);

    const bundle = await extractUseCase.execute({
      entryPath: getFixturePath(path.join("unsupported-contract", "contracts.ts")),
    });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(bundle.hasErrors).toBe(false);
    expect(lowered.hasErrors).toBe(true);

    const diagnosticCodes = lowered.diagnostics.map((diagnostic) => diagnostic.code);
    expect(diagnosticCodes).toEqual(
      expect.arrayContaining([
        "UNSUPPORTED_TYPE_ALIAS",
        "UNSUPPORTED_INLINE_OPTIONAL_PROPERTY",
        "UNSUPPORTED_TYPE_EXPRESSION",
      ]),
    );

    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_TYPE_ALIAS",
          message: expect.stringContaining('Type alias "ConditionalDto"'),
        }),
        expect.objectContaining({
          code: "UNSUPPORTED_TYPE_ALIAS",
          message: expect.stringContaining('Type alias "MappedDto"'),
        }),
        expect.objectContaining({
          code: "UNSUPPORTED_INLINE_OPTIONAL_PROPERTY",
          message: expect.stringContaining('Inline object property "optional"'),
        }),
        expect.objectContaining({
          code: "UNSUPPORTED_TYPE_EXPRESSION",
          message: expect.stringContaining("string &"),
        }),
      ]),
    );
  });
});
