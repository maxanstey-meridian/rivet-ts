import type { ContractEnumDeclaration } from "../../src/domain/rivet-contract-lowering-result.js";
import { generateEndpointMock } from "../../src/infrastructure/scaffold/mock-value-generator.js";
import { lowerSource } from "../support/lower.js";
import { AUTHORING_TYPES } from "../support/paths.js";

/**
 * The mock `scaffold-mock` generates for `GetThing: Endpoint<{ response: <response>, ...<spec> }>`,
 * with the lowered enum declarations unless `enums` rewrites them.
 */
const mockEndpoint = async (
  models: string,
  response: string,
  options: {
    readonly spec?: string;
    readonly enums?: (
      declarations: readonly ContractEnumDeclaration[],
    ) => readonly ContractEnumDeclaration[];
  } = {},
) => {
  const { lowered } = await lowerSource(`
import { brand, type Brand, type Contract, type Endpoint, type Format } from "${AUTHORING_TYPES}";

${models}

export interface ThingsContract extends Contract<"ThingsContract"> {
  GetThing: Endpoint<{ method: "GET"; route: "/api/thing"; response: ${response}${options.spec ?? ""} }>;
}
`);
  expect(lowered.diagnostics).toEqual([]);
  const [endpoint] = lowered.document.endpoints;
  if (!endpoint) {
    throw new Error("GetThing did not lower");
  }
  const enumDeclarations = options.enums?.(lowered.enumDeclarations) ?? lowered.enumDeclarations;
  return generateEndpointMock(endpoint, lowered.document, {
    enumDeclarations,
    dateTypes: lowered.dateTypes,
  });
};

const mockResponse = async (models: string, response: string) =>
  (await mockEndpoint(models, response)).result;

const NO_IMPORTS = { brand: false, enums: [] };

const BOX = "export interface Box<T> { value: T }";

const STATUS = `export enum Status { Active = "active", "On Hold" = "on-hold" }`;

describe("mock-value-generator recursion", () => {
  it("synthesizes a generic instantiated inside itself with other arguments", async () => {
    const result = await mockResponse(
      `${BOX}\nexport interface Nested<T> { outer: Box<Box<T>> }`,
      "Nested<string>",
    );

    expect(result).toEqual({
      kind: "value",
      source: JSON.stringify({ outer: { value: { value: "example" } } }, null, 2),
      imports: NO_IMPORTS,
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

describe("mock-value-generator typed source", () => {
  it("references a TS enum member and imports the enum from its module", async () => {
    const result = await mockResponse(
      `${STATUS}\nexport interface ThingDto { status: Status }`,
      "ThingDto",
    );

    expect(result).toEqual({
      kind: "value",
      source: '{\n  "status": Status.Active\n}',
      imports: {
        brand: false,
        enums: [
          {
            name: "Status",
            // Relative to the root the contract sources share, as they are copied.
            relativePath: expect.stringMatching(/(?:^|\/)contracts\.ts$/u),
          },
        ],
      },
    });
  });

  it("prints an enum-like alias value as its literal", async () => {
    const result = await mockResponse(
      `export type Sort = "asc" | "desc";\nexport interface ThingDto { sort: Sort }`,
      "ThingDto",
    );

    expect(result).toEqual({ kind: "value", source: '{\n  "sort": "asc"\n}', imports: NO_IMPORTS });
  });

  it("brands a branded value through brand() and a format as its plain literal", async () => {
    const result = await mockResponse(
      `export interface ThingDto { id: Format<string, "uuid">; tags: Brand<string, "Tag">[] }`,
      "ThingDto",
    );

    expect(result).toEqual({
      kind: "value",
      source:
        '{\n  "id": "00000000-0000-0000-0000-000000000000",\n  "tags": [\n    brand("example")\n  ]\n}',
      imports: { brand: true, enums: [] },
    });
  });

  it("prints a Date as new Date(...), and a date-time format as its string", async () => {
    const result = await mockResponse(
      `${BOX}\nexport interface ThingDto { at: Date | null; boxed: Box<Date>; stamp: Format<string, "date-time"> }`,
      "ThingDto",
    );

    expect(result).toEqual({
      kind: "value",
      source:
        '{\n  "at": new Date("2025-01-01T00:00:00.000Z"),\n  "boxed": {\n    "value": new Date("2025-01-01T00:00:00.000Z")\n  },\n  "stamp": "2025-01-01T00:00:00.000Z"\n}',
      imports: NO_IMPORTS,
    });
  });

  it("synthesizes instead of a response example whose Date is not a date", async () => {
    const { result, diagnostics } = await mockEndpoint(
      `export interface ThingDto { at: Date }
export const thing = { at: "soon" };`,
      "ThingDto",
      { spec: "; responseExamples: [{ status: 200; examples: [typeof thing] }]" },
    );

    expect(diagnostics).toMatchObject([
      {
        code: "SCAFFOLD_RESPONSE_EXAMPLE_MISMATCH",
        message: expect.stringContaining("response.at is not a date"),
      },
    ]);
    expect(result).toMatchObject({
      kind: "value",
      source: '{\n  "at": new Date("2025-01-01T00:00:00.000Z")\n}',
    });
  });

  it("returns a response example that fits the response type, typed", async () => {
    const { result, diagnostics } = await mockEndpoint(
      `${STATUS}
export interface ThingDto { id: string; status: Status; tag: Brand<string, "Tag"> }
export const thingExample = { id: "t1", status: Status["On Hold"], tag: brand("vip") } satisfies ThingDto;`,
      "ThingDto",
      { spec: "; responseExamples: [{ status: 200; examples: [typeof thingExample] }]" },
    );

    expect(diagnostics).toEqual([]);
    expect(result).toMatchObject({
      kind: "value",
      source: '{\n  "id": "t1",\n  "status": Status["On Hold"],\n  "tag": brand("vip")\n}',
    });
  });

  it("synthesizes instead of a response example that drifted from the response type, saying where", async () => {
    const { result, diagnostics } = await mockEndpoint(
      `${STATUS}
export interface ThingDto { id: string; status: Status }
export const drifted = { id: "t1", status: "retired" };`,
      "ThingDto",
      { spec: "; responseExamples: [{ status: 200; examples: [typeof drifted] }]" },
    );

    expect(diagnostics).toMatchObject([
      {
        code: "SCAFFOLD_RESPONSE_EXAMPLE_MISMATCH",
        message: expect.stringContaining('response.status is not a value of enum "Status"'),
      },
    ]);
    expect(result).toMatchObject({
      kind: "value",
      source: '{\n  "id": "example",\n  "status": Status.Active\n}',
    });
  });

  it("leaves a TODO for a TS enum declared outside the contract sources", async () => {
    const { result } = await mockEndpoint(
      `${STATUS}\nexport interface ThingDto { status: Status }`,
      "ThingDto",
      {
        enums: (declarations) =>
          declarations.map((declaration) => ({
            ...declaration,
            source: { kind: "outsideContractSources" },
          })),
      },
    );

    expect(result).toMatchObject({
      kind: "todo",
      message: expect.stringContaining(
        'enum "Status", which is declared outside the contract sources',
      ),
    });
  });

  it("leaves a TODO for a declare enum, which has no runtime value to import", async () => {
    const result = await mockResponse(
      `export declare enum Status { Active = "active" }\nexport interface ThingDto { status: Status }`,
      "ThingDto",
    );

    expect(result).toMatchObject({
      kind: "todo",
      message: expect.stringContaining('enum "Status", a `declare enum` with no runtime value'),
    });
  });

  it("references a computed enum member by its name", async () => {
    const result = await mockResponse(
      `export enum Status { ["On Hold"] = "on-hold" }\nexport interface ThingDto { status: Status }`,
      "ThingDto",
    );

    expect(result).toMatchObject({ kind: "value", source: '{\n  "status": Status["On Hold"]\n}' });
  });

  it("synthesizes instead of an example typed by a generic referenced without type arguments", async () => {
    const { result, diagnostics } = await mockEndpoint(
      `export interface Wrapper<T> { value: T }
export interface Page<T = string> { data: Wrapper<T> }
export const page = { data: { value: "a" } };`,
      "Page",
      { spec: "; responseExamples: [{ status: 200; examples: [typeof page] }]" },
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "SCAFFOLD_RESPONSE_EXAMPLE_MISMATCH",
        message: expect.stringContaining('generic type "Page" without type arguments'),
      }),
    );
    expect(result).toMatchObject({ kind: "todo" });
  });

  it("synthesizes instead of an example typed by a generic missing a defaulted type argument", async () => {
    const { diagnostics } = await mockEndpoint(
      `export interface Wrapper<T> { value: T }
export interface Page<A, T = number> { label: A; data: Wrapper<T> }
export const page = { label: "a", data: { value: 1 } };`,
      "Page<string>",
      { spec: "; responseExamples: [{ status: 200; examples: [typeof page] }]" },
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "SCAFFOLD_RESPONSE_EXAMPLE_MISMATCH",
        message: expect.stringContaining('unresolved generic type parameter "T"'),
      }),
    );
  });
});
