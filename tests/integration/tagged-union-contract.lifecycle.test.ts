import { lowerContracts } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { parseContractJson } from "../support/lower.js";
import { fixturePath } from "../support/paths.js";

describe("Tagged union contract lifecycle", () => {
  it("lowers discriminated object unions into tagged union contract types", async () => {
    const lowered = lowerContracts(fixturePath("tagged-union-contract", "contracts.ts"));

    expect(lowered.hasErrors).toBe(false);

    const payload = parseContractJson(lowered.toJson());

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
