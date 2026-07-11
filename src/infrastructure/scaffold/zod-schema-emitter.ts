import type {
  RivetContractDocument,
  RivetPropertyConstraints,
  RivetType,
  RivetTypeDefinition,
} from "../../domain/rivet-contract.js";

/**
 * IR → Zod source, at SCAFFOLD time only (the schemas are owned by the user
 * afterwards — this is not a generate-pipeline artifact, and the v2
 * types-only client decision is untouched).
 *
 * `exact` tracks whether the synthesized schema's output type provably equals
 * the contract type: only then does the caller append the
 * `satisfies z.ZodType<...>` lock. Inexact pieces (brands, tagged unions,
 * recursion, unknown) degrade to z.unknown() with a TODO so a fresh scaffold
 * still typechecks; the rules a human adds later tighten them.
 */

export type ZodSourceResult = {
  readonly source: string;
  readonly exact: boolean;
};

type Context = {
  readonly typeDefinitions: ReadonlyMap<string, RivetTypeDefinition>;
  readonly enumValues: ReadonlyMap<string, readonly (string | number)[]>;
  readonly substitutions: ReadonlyMap<string, RivetType>;
  readonly visiting: ReadonlySet<string>;
};

const inexact = (todo: string): ZodSourceResult => ({
  source: `z.unknown() /* TODO: ${todo} */`,
  exact: false,
});

const literalSource = (value: string | number | boolean): string =>
  typeof value === "string" ? `z.literal(${JSON.stringify(value)})` : `z.literal(${value})`;

/**
 * What a constrained property's type boils down to once refs-to-aliases,
 * brands, and type parameters are peeled away — decides WHICH JSON Schema
 * keywords may legally chain onto the synthesized source. Anything else
 * (objects, enums, unions, nullable aliases, recursion) takes no chain:
 * better to drop a constraint than emit source that cannot typecheck.
 */
type ConstrainableKind = "array" | "number" | "other" | "string";

const resolveConstrainableKind = (
  type: RivetType,
  context: Context,
  seen: ReadonlySet<string> = new Set(),
): ConstrainableKind => {
  switch (type.kind) {
    case "primitive":
      if (type.type === "string") {
        return "string";
      }
      return type.type === "number" ? "number" : "other";
    case "array":
      return "array";
    case "brand":
      return resolveConstrainableKind(type.underlying, context, seen);
    case "typeParam": {
      const substitution = context.substitutions.get(type.name);
      return substitution ? resolveConstrainableKind(substitution, context, seen) : "other";
    }
    case "ref": {
      if (seen.has(type.name) || context.enumValues.has(type.name)) {
        return "other";
      }
      const typeDef = context.typeDefinitions.get(type.name);
      // Only plain aliases resolve through; an aliased `.nullable()` source
      // would put the chain AFTER the wrapper, where .min()/.regex() do not
      // exist, so nullable aliases stay unconstrained.
      if (!typeDef?.type || typeDef.type.kind === "nullable") {
        return "other";
      }
      return resolveConstrainableKind(typeDef.type, context, new Set([...seen, type.name]));
    }
    default:
      return "other";
  }
};

/**
 * Chains JSON Schema validation keywords onto a synthesized Zod source.
 * Every method here returns the same schema class in Zod 4 (.refine
 * included), so the chain never changes the output TYPE — the `satisfies
 * z.ZodType<T>` exactness lock is unaffected.
 */
const constraintChain = (
  kind: ConstrainableKind,
  constraints: RivetPropertyConstraints,
): string => {
  const parts: string[] = [];

  if (kind === "string") {
    if (constraints.minLength !== undefined) {
      parts.push(`.min(${constraints.minLength})`);
    }
    if (constraints.maxLength !== undefined) {
      parts.push(`.max(${constraints.maxLength})`);
    }
    if (constraints.pattern !== undefined) {
      parts.push(`.regex(new RegExp(${JSON.stringify(constraints.pattern)}))`);
    }
  }

  if (kind === "number") {
    if (constraints.minimum !== undefined) {
      parts.push(`.gte(${constraints.minimum})`);
    }
    if (constraints.maximum !== undefined) {
      parts.push(`.lte(${constraints.maximum})`);
    }
    if (constraints.exclusiveMinimum !== undefined) {
      parts.push(`.gt(${constraints.exclusiveMinimum})`);
    }
    if (constraints.exclusiveMaximum !== undefined) {
      parts.push(`.lt(${constraints.exclusiveMaximum})`);
    }
    if (constraints.multipleOf !== undefined) {
      parts.push(`.multipleOf(${constraints.multipleOf})`);
    }
  }

  if (kind === "array") {
    if (constraints.minItems !== undefined) {
      parts.push(`.min(${constraints.minItems})`);
    }
    if (constraints.maxItems !== undefined) {
      parts.push(`.max(${constraints.maxItems})`);
    }
    if (constraints.uniqueItems === true) {
      parts.push(
        ".refine((items) => new Set(items.map((item) => JSON.stringify(item))).size === items.length, " +
          '"Array items must be unique.")',
      );
    }
  }

  return parts.join("");
};

/**
 * Property-level synthesis: same as `synthesize`, but chains the property's
 * contract constraints onto the source. Nullable/brand wrappers recurse so
 * the chain lands on the INNER schema (`z.string().min(1).nullable()`, never
 * `.nullable().min(1)`).
 */
const synthesizeConstrained = (
  type: RivetType,
  context: Context,
  constraints: RivetPropertyConstraints | undefined,
): ZodSourceResult => {
  if (!constraints) {
    return synthesize(type, context);
  }

  if (type.kind === "nullable") {
    const inner = synthesizeConstrained(type.inner, context, constraints);
    return { source: `${inner.source}.nullable()`, exact: inner.exact };
  }

  if (type.kind === "brand") {
    const underlying = synthesizeConstrained(type.underlying, context, constraints);
    return { source: underlying.source, exact: false };
  }

  const base = synthesize(type, context);
  return {
    source: `${base.source}${constraintChain(resolveConstrainableKind(type, context), constraints)}`,
    exact: base.exact,
  };
};

const synthesizeObject = (
  properties: readonly {
    name: string;
    type: RivetType;
    optional?: boolean;
    constraints?: RivetPropertyConstraints;
  }[],
  context: Context,
): ZodSourceResult => {
  const parts: string[] = [];
  let exact = true;

  for (const property of properties) {
    const value = synthesizeConstrained(property.type, context, property.constraints);
    exact = exact && value.exact;
    const suffix = property.optional ? ".optional()" : "";
    parts.push(`${JSON.stringify(property.name)}: ${value.source}${suffix}`);
  }

  return { source: `z.object({ ${parts.join(", ")} })`, exact };
};

const synthesize = (type: RivetType, context: Context): ZodSourceResult => {
  switch (type.kind) {
    case "primitive":
      switch (type.type) {
        case "string":
          return { source: "z.string()", exact: true };
        case "number":
          return { source: "z.number()", exact: true };
        case "boolean":
          return { source: "z.boolean()", exact: true };
        default:
          return inexact(`unsupported primitive "${type.type}"`);
      }

    case "nullable": {
      const inner = synthesize(type.inner, context);
      return { source: `${inner.source}.nullable()`, exact: inner.exact };
    }

    case "array": {
      const element = synthesize(type.element, context);
      return { source: `z.array(${element.source})`, exact: element.exact };
    }

    case "dictionary": {
      const value = synthesize(type.value, context);
      return { source: `z.record(z.string(), ${value.source})`, exact: value.exact };
    }

    case "stringUnion":
      if (type.values.length === 0) {
        return inexact("empty string union");
      }
      return {
        source: `z.enum([${type.values.map((value) => JSON.stringify(value)).join(", ")}])`,
        exact: true,
      };

    case "intUnion":
      if (type.values.length === 0) {
        return inexact("empty int union");
      }
      if (type.values.length === 1) {
        return { source: literalSource(type.values[0]!), exact: true };
      }
      return {
        source: `z.union([${type.values.map(literalSource).join(", ")}])`,
        exact: true,
      };

    case "literal":
      return { source: literalSource(type.value), exact: true };

    case "union": {
      const variants = type.variants.map((variant) => synthesize(variant, context));
      if (variants.length === 0) {
        return inexact("empty union");
      }
      if (variants.length === 1) {
        return variants[0]!;
      }
      return {
        source: `z.union([${variants.map((variant) => variant.source).join(", ")}])`,
        exact: variants.every((variant) => variant.exact),
      };
    }

    case "ref": {
      const enumValues = context.enumValues.get(type.name);
      if (enumValues && enumValues.length > 0) {
        if (enumValues.every((value) => typeof value === "string")) {
          return {
            source: `z.enum([${enumValues.map((value) => JSON.stringify(value)).join(", ")}])`,
            // TS enums are nominal; a value union never satisfies them.
            exact: false,
          };
        }
        return inexact(`int enum "${type.name}" — validate the member values`);
      }

      const typeDef = context.typeDefinitions.get(type.name);
      if (!typeDef) {
        return inexact(`unknown type "${type.name}"`);
      }
      if (context.visiting.has(type.name)) {
        return inexact(`recursive type "${type.name}"`);
      }
      if (typeDef.typeParameters.length > 0) {
        return inexact(`generic type "${type.name}" without arguments`);
      }

      const nested: Context = {
        ...context,
        visiting: new Set([...context.visiting, type.name]),
      };
      return typeDef.type
        ? synthesize(typeDef.type, nested)
        : synthesizeObject(typeDef.properties, nested);
    }

    case "generic": {
      const typeDef = context.typeDefinitions.get(type.name);
      if (!typeDef) {
        return inexact(`unknown generic type "${type.name}"`);
      }
      if (context.visiting.has(type.name)) {
        return inexact(`recursive generic type "${type.name}"`);
      }

      const substitutions = new Map(context.substitutions);
      for (const [index, parameter] of typeDef.typeParameters.entries()) {
        const argument = type.typeArgs[index];
        if (argument) {
          substitutions.set(parameter, argument);
        }
      }

      const nested: Context = {
        ...context,
        substitutions,
        visiting: new Set([...context.visiting, type.name]),
      };
      return typeDef.type
        ? synthesize(typeDef.type, nested)
        : synthesizeObject(typeDef.properties, nested);
    }

    case "typeParam": {
      const substitution = context.substitutions.get(type.name);
      if (!substitution) {
        return inexact(`unresolved type parameter "${type.name}"`);
      }
      return synthesize(substitution, context);
    }

    case "brand": {
      const underlying = synthesize(type.underlying, context);
      // The schema validates the underlying shape, but its output type is not
      // the branded type — never lock these.
      return { source: underlying.source, exact: false };
    }

    case "inlineObject":
      return synthesizeObject(type.properties, context);

    case "taggedUnion":
      return inexact("tagged union — model with z.discriminatedUnion");

    default:
      return inexact("unsupported type shape");
  }
};

export const zodSourceForType = (
  type: RivetType,
  document: RivetContractDocument,
): ZodSourceResult =>
  synthesize(type, {
    typeDefinitions: new Map(document.types.map((definition) => [definition.name, definition])),
    enumValues: new Map(
      document.enums.map((entry) => [
        entry.name,
        "values" in entry ? entry.values : entry.intValues,
      ]),
    ),
    substitutions: new Map(),
    visiting: new Set(),
  });
