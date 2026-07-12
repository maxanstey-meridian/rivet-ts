import {
  MockProjectEmitter,
  type MockProjectEmitterConfig,
} from "../../src/application/ports/mock-project-emitter.js";
import { RivetContractDocument, RivetTypeDefinition } from "../../src/domain/rivet-contract.js";
import {
  ConstraintEnrichingMockProjectEmitter,
  enrichDocumentWithConstraints,
  readOpenApiConstraints,
} from "../../src/infrastructure/scaffold/openapi-constraint-reader.js";

/**
 * Fixture shaped like the Rivet binary's real output (SchemaEnricher
 * conventions): OpenAPI 3.1, named components under components.schemas,
 * constraints as SIBLING keywords on each property node — including next to
 * 3.1 nullable type arrays, anyOf nullable wrappers, and bare $refs.
 */
const emitterShapedSpec = {
  openapi: "3.1.0",
  info: { title: "products", version: "0.0.0" },
  paths: {},
  components: {
    schemas: {
      ProductDto: {
        type: "object",
        description: "A product listing",
        properties: {
          id: { type: "string", readOnly: true },
          name: { type: "string", minLength: 1, maxLength: 200, description: "Product name" },
          price: { type: "number", minimum: 0 },
          weight: { type: "number", minimum: 5, exclusiveMinimum: 0 },
          slug: { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-z]+$" },
          score: { type: "number", minimum: 0, maximum: 999.5, multipleOf: 0.5 },
          tags: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 5,
            uniqueItems: true,
          },
          nickname: { type: ["string", "null"], minLength: 2 },
          category: { $ref: "#/components/schemas/CategoryDto", minLength: 3 },
          parent: {
            anyOf: [{ $ref: "#/components/schemas/CategoryDto" }, { type: "null" }],
            maxLength: 9,
          },
        },
        required: ["id", "name"],
      },
      CategoryDto: {
        type: "object",
        properties: { name: { type: "string" } },
      },
      LegacyRange: {
        type: "object",
        properties: {
          // OpenAPI 3.0 / draft-4 boolean exclusives modify minimum/maximum.
          amount: { type: "number", minimum: 0, exclusiveMinimum: true },
          limit: { type: "number", maximum: 10, exclusiveMaximum: true },
        },
      },
      Garbage: {
        type: "object",
        properties: {
          broken: {
            type: "string",
            minLength: -1,
            maxLength: "yes",
            minimum: Number.NaN,
            uniqueItems: "true",
            pattern: 42,
          },
        },
      },
    },
  },
};

describe("readOpenApiConstraints", () => {
  it("extracts the full keyword set per component property", () => {
    const index = readOpenApiConstraints(emitterShapedSpec);
    const product = index.get("ProductDto");

    expect(product).toBeDefined();
    expect(product?.get("name")).toEqual({ minLength: 1, maxLength: 200 });
    expect(product?.get("price")).toEqual({ minimum: 0 });
    expect(product?.get("weight")).toEqual({ minimum: 5, exclusiveMinimum: 0 });
    expect(product?.get("slug")).toEqual({ minLength: 1, maxLength: 100, pattern: "^[a-z]+$" });
    expect(product?.get("score")).toEqual({ minimum: 0, maximum: 999.5, multipleOf: 0.5 });
    expect(product?.get("tags")).toEqual({ minItems: 1, maxItems: 5, uniqueItems: true });
    expect(product?.get("id")).toBeUndefined();
  });

  it("reads constraints as siblings of nullable type arrays, $refs, and anyOf wrappers", () => {
    const product = readOpenApiConstraints(emitterShapedSpec).get("ProductDto");

    expect(product?.get("nickname")).toEqual({ minLength: 2 });
    expect(product?.get("category")).toEqual({ minLength: 3 });
    expect(product?.get("parent")).toEqual({ maxLength: 9 });
  });

  it("translates draft-4 boolean exclusive bounds into numeric exclusives", () => {
    const legacy = readOpenApiConstraints(emitterShapedSpec).get("LegacyRange");

    expect(legacy?.get("amount")).toEqual({ exclusiveMinimum: 0 });
    expect(legacy?.get("limit")).toEqual({ exclusiveMaximum: 10 });
  });

  it("ignores malformed keyword values and constraint-free components", () => {
    const index = readOpenApiConstraints(emitterShapedSpec);

    expect(index.has("Garbage")).toBe(false);
    expect(index.has("CategoryDto")).toBe(false);
  });

  it("returns an empty index for specs without component schemas", () => {
    expect(readOpenApiConstraints({ openapi: "3.1.0", paths: {} }).size).toBe(0);
    expect(readOpenApiConstraints(undefined).size).toBe(0);
    expect(readOpenApiConstraints("not a spec").size).toBe(0);
  });
});

describe("enrichDocumentWithConstraints", () => {
  const baseDocument = (): RivetContractDocument =>
    new RivetContractDocument({
      types: [
        new RivetTypeDefinition({
          name: "ProductDto",
          properties: [
            { name: "name", type: { kind: "primitive", type: "string" }, optional: false },
            { name: "id", type: { kind: "primitive", type: "string" }, optional: false },
          ],
        }),
        new RivetTypeDefinition({
          name: "Slug",
          type: { kind: "primitive", type: "string" },
        }),
      ],
    });

  it("attaches constraints by exact component/property name and leaves the rest alone", () => {
    const index = readOpenApiConstraints(emitterShapedSpec);
    const enriched = enrichDocumentWithConstraints(baseDocument(), index);

    const product = enriched.types.find((definition) => definition.name === "ProductDto");
    expect(product?.properties.find((property) => property.name === "name")?.constraints).toEqual({
      minLength: 1,
      maxLength: 200,
    });
    expect(
      product?.properties.find((property) => property.name === "id")?.constraints,
    ).toBeUndefined();
  });

  it("never touches alias definitions and returns the same document for an empty index", () => {
    const document = baseDocument();
    const enriched = enrichDocumentWithConstraints(
      document,
      readOpenApiConstraints(emitterShapedSpec),
    );

    const alias = enriched.types.find((definition) => definition.name === "Slug");
    expect(alias).toBe(document.types[1]);

    expect(enrichDocumentWithConstraints(document, new Map())).toBe(document);
  });

  it("keeps the enriched document wire-legal: alias defs still omit properties", () => {
    const enriched = enrichDocumentWithConstraints(
      baseDocument(),
      readOpenApiConstraints(emitterShapedSpec),
    );
    const serialized = JSON.parse(JSON.stringify(enriched)) as {
      types: Array<Record<string, unknown>>;
    };

    const product = serialized.types.find((definition) => definition.name === "ProductDto");
    const alias = serialized.types.find((definition) => definition.name === "Slug");
    const properties = (product?.properties ?? []) as Array<Record<string, unknown>>;
    const name = properties.find((property) => property.name === "name");
    expect(name?.constraints).toEqual({ minLength: 1, maxLength: 200 });
    expect(alias?.properties).toBeUndefined();
  });
});

describe("ConstraintEnrichingMockProjectEmitter", () => {
  it("hands the inner emitter an enriched document, all other config untouched", async () => {
    const received: MockProjectEmitterConfig[] = [];
    class RecordingEmitter implements MockProjectEmitter {
      public emit(config: MockProjectEmitterConfig): Promise<void> {
        received.push(config);
        return Promise.resolve();
      }
    }

    const document = new RivetContractDocument({
      types: [
        new RivetTypeDefinition({
          name: "ProductDto",
          properties: [
            { name: "name", type: { kind: "primitive", type: "string" }, optional: false },
          ],
        }),
      ],
    });

    const emitter = new ConstraintEnrichingMockProjectEmitter(
      new RecordingEmitter(),
      readOpenApiConstraints(emitterShapedSpec),
    );
    await emitter.emit({
      outDir: "/tmp/out",
      projectName: "demo",
      entryPath: "/tmp/contracts.ts",
      contracts: [],
      document,
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.outDir).toBe("/tmp/out");
    expect(received[0]?.document.types[0]?.properties[0]?.constraints).toEqual({
      minLength: 1,
      maxLength: 200,
    });
  });
});
