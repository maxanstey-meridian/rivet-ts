import path from "node:path";
import { fileURLToPath } from "node:url";
import { LowerTsContractsToRivetContract } from "../../src/application/use-cases/lower-ts-contracts-to-rivet-contract.js";
import { TypeScriptRivetContractLowerer } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

describe("Invalid tagged union contract lifecycle", () => {
  it("emits explicit diagnostics for unsupported discriminated union shapes", async () => {
    const lowerer = new TypeScriptRivetContractLowerer();
    const lowerUseCase = new LowerTsContractsToRivetContract(lowerer);

    const lowered = await lowerUseCase.execute({
      entryPath: getFixturePath(path.join("invalid-tagged-union-contract", "contracts.ts")),
    });

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
    ]);

    // Invalid unions are dropped; the variant with an optional non-discriminator
    // property now survives as a tagged union.
    const payload = JSON.parse(lowered.toJson()) as {
      endpoints: Array<{ name: string; responses: Array<{ dataType: unknown }> }>;
      types: Array<{ name: string; type?: unknown }>;
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
    expect(payload.types).toEqual([
      expect.objectContaining({
        name: "OptionalVariantFieldState",
        type: expect.objectContaining({
          kind: "taggedUnion",
          variants: expect.arrayContaining([
            expect.objectContaining({
              tag: "loading",
              type: expect.objectContaining({
                properties: expect.arrayContaining([
                  expect.objectContaining({ name: "kind" }),
                  expect.objectContaining({ name: "requestId", optional: true }),
                ]),
              }),
            }),
          ]),
        }),
      }),
    ]);
    expect(payload.enums).toEqual([]);
  });
});
