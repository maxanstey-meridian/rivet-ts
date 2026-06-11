import path from "node:path";
import { fileURLToPath } from "node:url";
import { LowerTsContractsToRivetContract } from "../../src/application/use-cases/lower-ts-contracts-to-rivet-contract.js";
import { TypeScriptRivetContractLowerer } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

describe("Unsupported contract lifecycle", () => {
  it("emits explicit diagnostics for unsupported TS constructs", async () => {
    const lowerer = new TypeScriptRivetContractLowerer();
    const lowerUseCase = new LowerTsContractsToRivetContract(lowerer);

    const lowered = await lowerUseCase.execute({
      entryPath: getFixturePath(path.join("unsupported-contract", "contracts.ts")),
    });

    expect(lowered.hasErrors).toBe(true);

    const modelsPath = getFixturePath(path.join("unsupported-contract", "models.ts"));
    expect(lowered.diagnostics).toEqual([
      expect.objectContaining({
        severity: "error",
        code: "UNSUPPORTED_TYPE_EXPRESSION",
        message: 'Unsupported type expression "TValue extends string ? { value: TValue } : never".',
        filePath: modelsPath,
        line: 1,
      }),
      expect.objectContaining({
        severity: "error",
        code: "UNSUPPORTED_INLINE_OPTIONAL_PROPERTY",
        message: 'Inline object property "optional" cannot be optional.',
        filePath: modelsPath,
        line: 10,
      }),
      expect.objectContaining({
        severity: "error",
        code: "UNSUPPORTED_TYPE_EXPRESSION",
        message: 'Unsupported type expression "string & { readonly __tag: "Value" }".',
        filePath: modelsPath,
        line: 15,
      }),
      expect.objectContaining({
        severity: "error",
        code: "UNSUPPORTED_TYPE_EXPRESSION",
        message: 'Unsupported type expression "{\n  [TKey in keyof TValue]: string;\n}".',
        filePath: modelsPath,
        line: 3,
      }),
    ]);

    // The unsupported constructs are dropped from the lowered document: the
    // endpoints survive with type references, but no type definitions are
    // emitted for them.
    const payload = JSON.parse(lowered.toJson()) as {
      endpoints: Array<{ name: string; responses: Array<{ dataType: unknown }> }>;
      types: unknown[];
      enums: unknown[];
    };
    expect(payload.endpoints.map((endpoint) => endpoint.name)).toEqual([
      "search",
      "details",
      "intersect",
    ]);
    expect(payload.endpoints[0]?.responses[0]?.dataType).toEqual({
      kind: "generic",
      name: "ConditionalDto",
      typeArgs: [{ kind: "primitive", type: "string" }],
    });
    expect(payload.types).toEqual([]);
    expect(payload.enums).toEqual([]);
  });
});
