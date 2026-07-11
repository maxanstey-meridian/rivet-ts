import { z } from "zod";
import {
  RivetContractDocument,
  type RivetPropertyConstraints,
  type RivetPropertyDefinition,
  RivetTypeDefinition,
  type RivetType,
} from "../../src/domain/rivet-contract.js";
import { zodSourceForType } from "../../src/infrastructure/scaffold/zod-schema-emitter.js";

const stringType: RivetType = { kind: "primitive", type: "string" };
const numberType: RivetType = { kind: "primitive", type: "number" };

const documentWithRequest = (
  properties: readonly RivetPropertyDefinition[],
  extraTypes: readonly RivetTypeDefinition[] = [],
): RivetContractDocument =>
  new RivetContractDocument({
    types: [new RivetTypeDefinition({ name: "Request", properties }), ...extraTypes],
  });

const synthesizeRequest = (
  properties: readonly RivetPropertyDefinition[],
  extraTypes: readonly RivetTypeDefinition[] = [],
) =>
  zodSourceForType({ kind: "ref", name: "Request" }, documentWithRequest(properties, extraTypes));

// The emitted source is real Zod input — evaluating it against the pinned
// zod is the only honest oracle for the chained constraint behavior.
const evaluate = (source: string): z.ZodType =>
  new Function("z", `return ${source};`)(z) as z.ZodType;

describe("zod-schema-emitter constraints", () => {
  it("emits exact heterogeneous scalar unions", () => {
    const result = zodSourceForType(
      {
        kind: "union",
        variants: [
          { kind: "primitive", type: "number" },
          { kind: "literal", value: false },
        ],
      },
      new RivetContractDocument({}),
    );

    expect(result).toEqual({ source: "z.union([z.number(), z.literal(false)])", exact: true });
    expect(evaluate(result.source).safeParse(false).success).toBe(true);
    expect(evaluate(result.source).safeParse(true).success).toBe(false);
  });

  it("chains minLength, maxLength, and pattern onto string properties", () => {
    const result = synthesizeRequest([
      {
        name: "slug",
        type: stringType,
        optional: false,
        constraints: { minLength: 2, maxLength: 5, pattern: "^[a-z]+$" },
      },
    ]);

    expect(result.source).toBe(
      'z.object({ "slug": z.string().min(2).max(5).regex(new RegExp("^[a-z]+$")) })',
    );
    expect(result.exact).toBe(true);

    const schema = evaluate(result.source);
    expect(schema.safeParse({ slug: "abc" }).success).toBe(true);
    expect(schema.safeParse({ slug: "a" }).success).toBe(false);
    expect(schema.safeParse({ slug: "toolong" }).success).toBe(false);
    expect(schema.safeParse({ slug: "ABC" }).success).toBe(false);
  });

  it("chains minimum, maximum, exclusive bounds, and multipleOf onto number properties", () => {
    const result = synthesizeRequest([
      {
        name: "price",
        type: numberType,
        optional: false,
        constraints: { minimum: 0, maximum: 10 },
      },
      {
        name: "weight",
        type: numberType,
        optional: false,
        constraints: { exclusiveMinimum: 0, exclusiveMaximum: 5 },
      },
      { name: "score", type: numberType, optional: false, constraints: { multipleOf: 0.5 } },
    ]);

    expect(result.source).toContain('"price": z.number().gte(0).lte(10)');
    expect(result.source).toContain('"weight": z.number().gt(0).lt(5)');
    expect(result.source).toContain('"score": z.number().multipleOf(0.5)');

    const schema = evaluate(result.source);
    const valid = { price: 10, weight: 2.5, score: 1.5 };
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, price: -1 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, weight: 0 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, weight: 5 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, score: 1.3 }).success).toBe(false);
  });

  it("chains minItems, maxItems, and a uniqueItems refine onto array properties", () => {
    const result = synthesizeRequest([
      {
        name: "tags",
        type: { kind: "array", element: stringType },
        optional: false,
        constraints: { minItems: 1, maxItems: 3, uniqueItems: true },
      },
    ]);

    expect(result.source).toContain("z.array(z.string()).min(1).max(3).refine(");
    expect(result.exact).toBe(true);

    const schema = evaluate(result.source);
    expect(schema.safeParse({ tags: ["a", "b"] }).success).toBe(true);
    expect(schema.safeParse({ tags: [] }).success).toBe(false);
    expect(schema.safeParse({ tags: ["a", "b", "c", "d"] }).success).toBe(false);
    expect(schema.safeParse({ tags: ["a", "a"] }).success).toBe(false);
  });

  it("applies constraints INSIDE the nullable wrapper", () => {
    const result = synthesizeRequest([
      {
        name: "nickname",
        type: { kind: "nullable", inner: stringType },
        optional: false,
        constraints: { minLength: 2 },
      },
    ]);

    expect(result.source).toBe('z.object({ "nickname": z.string().min(2).nullable() })');

    const schema = evaluate(result.source);
    expect(schema.safeParse({ nickname: null }).success).toBe(true);
    expect(schema.safeParse({ nickname: "ok" }).success).toBe(true);
    expect(schema.safeParse({ nickname: "x" }).success).toBe(false);
  });

  it("applies constraints before the optional suffix", () => {
    const result = synthesizeRequest([
      { name: "note", type: stringType, optional: true, constraints: { maxLength: 3 } },
    ]);

    expect(result.source).toBe('z.object({ "note": z.string().max(3).optional() })');

    const schema = evaluate(result.source);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ note: "ok" }).success).toBe(true);
    expect(schema.safeParse({ note: "long" }).success).toBe(false);
  });

  it("carries constraints through brands and stays inexact", () => {
    const result = synthesizeRequest([
      {
        name: "id",
        type: { kind: "brand", name: "MemberId", underlying: stringType },
        optional: false,
        constraints: { minLength: 4 },
      },
    ]);

    expect(result.source).toBe('z.object({ "id": z.string().min(4) })');
    expect(result.exact).toBe(false);
  });

  it("chains constraints through refs to plain string aliases", () => {
    const result = synthesizeRequest(
      [
        {
          name: "slug",
          type: { kind: "ref", name: "Slug" },
          optional: false,
          constraints: { minLength: 2 },
        },
      ],
      [new RivetTypeDefinition({ name: "Slug", type: stringType })],
    );

    expect(result.source).toBe('z.object({ "slug": z.string().min(2) })');
  });

  it("drops constraints on refs to NULLABLE aliases instead of emitting a broken chain", () => {
    const result = synthesizeRequest(
      [
        {
          name: "nickname",
          type: { kind: "ref", name: "Nickname" },
          optional: false,
          constraints: { minLength: 2 },
        },
      ],
      [
        new RivetTypeDefinition({
          name: "Nickname",
          type: { kind: "nullable", inner: stringType },
        }),
      ],
    );

    // .min(2) after .nullable() would not typecheck; the shape still parses.
    expect(result.source).toBe('z.object({ "nickname": z.string().nullable() })');
  });

  it("ignores keywords that do not apply to the property's effective type", () => {
    const constraints: RivetPropertyConstraints = {
      minimum: 1,
      minItems: 1,
      uniqueItems: true,
    };
    const result = synthesizeRequest([
      { name: "name", type: stringType, optional: false, constraints },
      {
        name: "status",
        type: { kind: "stringUnion", values: ["open", "closed"] },
        optional: false,
        constraints: { minLength: 2 },
      },
    ]);

    expect(result.source).toBe(
      'z.object({ "name": z.string(), "status": z.enum(["open", "closed"]) })',
    );
  });

  it("leaves unconstrained synthesis byte-identical to before", () => {
    const result = synthesizeRequest([
      { name: "email", type: stringType, optional: false },
      { name: "count", type: numberType, optional: true },
    ]);

    expect(result.source).toBe('z.object({ "email": z.string(), "count": z.number().optional() })');
    expect(result.exact).toBe(true);
  });
});
