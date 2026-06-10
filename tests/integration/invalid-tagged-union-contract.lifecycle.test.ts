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

    const modelsPath = getFixturePath(path.join("invalid-tagged-union-contract", "models.ts"));
    expect(lowered.diagnostics).toEqual([
      // DifferentDiscriminatorState: members disagree on the discriminator
      // property, so the union falls through to the generic rejection.
      expect.objectContaining({
        severity: "error",
        code: "UNSUPPORTED_UNION",
        message:
          'Union "| { kind: "hidden"; workspaceKey: string | null }\n' +
          '  | { state: "shown"; summary: string }" is not supported.',
        filePath: modelsPath,
        line: 2,
      }),
      // DuplicateTagState: the duplicate tag is reported at the repeated
      // discriminator literal, then the union as a whole is rejected.
      expect.objectContaining({
        severity: "error",
        code: "UNSUPPORTED_UNION",
        message:
          'Union "| { kind: "hidden"; workspaceKey: string | null }\n' +
          '  | { kind: "hidden"; summary: string }" repeats discriminator value "hidden".',
        filePath: modelsPath,
        line: 7,
      }),
      expect.objectContaining({
        severity: "error",
        code: "UNSUPPORTED_UNION",
        message:
          'Union "| { kind: "hidden"; workspaceKey: string | null }\n' +
          '  | { kind: "hidden"; summary: string }" is not supported.',
        filePath: modelsPath,
        line: 6,
      }),
      // MixedMemberState: object and literal members cannot be mixed.
      expect.objectContaining({
        severity: "error",
        code: "UNSUPPORTED_UNION",
        message:
          'Union "{ kind: "hidden"; workspaceKey: string | null } | "shown"" is not supported.',
        filePath: modelsPath,
        line: 13,
      }),
      // OptionalVariantFieldState: the optional property is reported at its
      // type node, then the union as a whole is rejected.
      expect.objectContaining({
        severity: "error",
        code: "UNSUPPORTED_UNION",
        message:
          'Union "| { kind: "loading"; requestId?: string; workspaceKey: string }\n' +
          '  | { kind: "shown"; summary: string; workspaceKey: string }" cannot use optional properties in tagged union variants.',
        filePath: modelsPath,
        line: 10,
      }),
      expect.objectContaining({
        severity: "error",
        code: "UNSUPPORTED_UNION",
        message:
          'Union "| { kind: "loading"; requestId?: string; workspaceKey: string }\n' +
          '  | { kind: "shown"; summary: string; workspaceKey: string }" is not supported.',
        filePath: modelsPath,
        line: 10,
      }),
    ]);

    // The invalid unions are dropped from the lowered document: every endpoint
    // survives with a ref to its state type, but no type definitions are
    // emitted for the rejected unions.
    const payload = JSON.parse(lowered.toJson()) as {
      endpoints: Array<{ name: string; responses: Array<{ dataType: unknown }> }>;
      types: unknown[];
      enums: unknown[];
    };
    expect(payload.endpoints.map((endpoint) => endpoint.name)).toEqual([
      "differentDiscriminator",
      "duplicateTag",
      "optionalVariantField",
      "mixedMember",
    ]);
    expect(payload.endpoints.map((endpoint) => endpoint.responses[0]?.dataType)).toEqual([
      { kind: "ref", name: "DifferentDiscriminatorState" },
      { kind: "ref", name: "DuplicateTagState" },
      { kind: "ref", name: "OptionalVariantFieldState" },
      { kind: "ref", name: "MixedMemberState" },
    ]);
    expect(payload.types).toEqual([]);
    expect(payload.enums).toEqual([]);
  });
});
