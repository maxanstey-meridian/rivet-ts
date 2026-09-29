import { generateEndpointMock } from "../../src/infrastructure/scaffold/mock-value-generator.js";
import { lowerSource } from "../support/lower.js";
import { AUTHORING_TYPES } from "../support/paths.js";

/** The mock `scaffold-mock` synthesizes for the response of `GetThing: Endpoint<{ response: <response> }>`. */
const mockResponse = async (models: string, response: string) => {
  const { lowered } = await lowerSource(`
import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

${models}

export interface ThingsContract extends Contract<"ThingsContract"> {
  GetThing: Endpoint<{ method: "GET"; route: "/api/thing"; response: ${response} }>;
}
`);
  expect(lowered.diagnostics).toEqual([]);
  const [endpoint] = lowered.document.endpoints;
  return endpoint && generateEndpointMock(endpoint, lowered.document).result;
};

const BOX = "export interface Box<T> { value: T }";

describe("mock-value-generator recursion", () => {
  it("synthesizes a generic instantiated inside itself with other arguments", async () => {
    const result = await mockResponse(
      `${BOX}\nexport interface Nested<T> { outer: Box<Box<T>> }`,
      "Nested<string>",
    );

    expect(result).toEqual({
      kind: "value",
      value: { outer: { value: { value: "example" } } },
      needsCast: false,
    });
  });

  it.each([
    ["the same instantiation", "Tree<T>"],
    ["ever-deeper instantiations", "Tree<Box<T>>"],
  ])("leaves a TODO for a generic that recurses into %s", async (_, child) => {
    const result = await mockResponse(
      `${BOX}\nexport interface Tree<T> { value: T; child: ${child} }`,
      "Tree<string>",
    );

    expect(result).toMatchObject({ kind: "todo", message: expect.stringContaining("Tree") });
  });
});
