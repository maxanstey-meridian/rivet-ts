import type {
  RivetContractDocument,
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

const literalSource = (value: string | number): string =>
  typeof value === "string" ? `z.literal(${JSON.stringify(value)})` : `z.literal(${value})`;

const synthesizeObject = (
  properties: readonly { name: string; type: RivetType; optional?: boolean }[],
  context: Context,
): ZodSourceResult => {
  const parts: string[] = [];
  let exact = true;

  for (const property of properties) {
    const value = synthesize(property.type, context);
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
