import path from "node:path";
import { fileURLToPath } from "node:url";
import { LowerTsContractsToRivetContract } from "../../src/application/use-cases/lower-ts-contracts-to-rivet-contract.js";
import { TypeScriptRivetContractLowerer } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

describe("Tagged union contract lifecycle", () => {
  it("lowers discriminated object unions into tagged union contract types", async () => {
    const lowerer = new TypeScriptRivetContractLowerer();
    const lowerUseCase = new LowerTsContractsToRivetContract(lowerer);

    const lowered = await lowerUseCase.execute({
      entryPath: getFixturePath(path.join("tagged-union-contract", "contracts.ts")),
    });

    expect(lowered.hasErrors).toBe(false);

    const payload = JSON.parse(lowered.toJson()) as {
      types: Array<{
        name: string;
        type?: {
          kind: string;
          discriminator: string;
          variants: Array<{
            tag: string;
            type: { kind: string; properties: Array<{ name: string }> };
          }>;
        };
      }>;
      endpoints: Array<{
        name: string;
        responses: Array<{ statusCode: number; dataType?: { kind: string; name?: string } }>;
      }>;
    };

    const displayState = payload.types.find((type) => type.name === "DisplayStateContract");
    expect(displayState?.type).toEqual(
      expect.objectContaining({
        kind: "taggedUnion",
        discriminator: "kind",
        variants: expect.arrayContaining([
          expect.objectContaining({
            tag: "hidden",
            type: expect.objectContaining({
              kind: "inlineObject",
              properties: expect.arrayContaining([
                expect.objectContaining({ name: "kind" }),
                expect.objectContaining({ name: "workspaceKey" }),
              ]),
            }),
          }),
          expect.objectContaining({
            tag: "loading",
            type: expect.objectContaining({
              kind: "inlineObject",
              properties: expect.arrayContaining([
                expect.objectContaining({ name: "requestId" }),
                expect.objectContaining({ name: "workspaceKey" }),
              ]),
            }),
          }),
          expect.objectContaining({
            tag: "shown",
            type: expect.objectContaining({
              kind: "inlineObject",
              properties: expect.arrayContaining([
                expect.objectContaining({ name: "summary" }),
                expect.objectContaining({ name: "workspaceKey" }),
              ]),
            }),
          }),
        ]),
      }),
    );

    const refreshEndpoint = payload.endpoints.find((endpoint) => endpoint.name === "refresh");
    expect(refreshEndpoint?.responses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statusCode: 201,
          dataType: { kind: "ref", name: "DisplayStateContract" },
        }),
      ]),
    );
  });
});
