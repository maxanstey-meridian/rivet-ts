import { toSafeIdentifier } from "../../src/infrastructure/scaffold/mock-project-emitter.js";

describe("mock project identifiers", () => {
  it.each([
    ["Export", "exportEndpoint"],
    ["Delete", "deleteEndpoint"],
    ["Default", "defaultEndpoint"],
    ["Class", "classEndpoint"],
    ["ListMembers", "listMembers"],
    ["123 Export", "_123Export"],
    ["---", "_"],
  ])("maps %s to %s", (endpointName, expected) => {
    expect(toSafeIdentifier(endpointName)).toBe(expected);
  });
});
