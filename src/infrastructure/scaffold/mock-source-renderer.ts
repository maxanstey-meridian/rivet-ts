import type {
  ContractEnumDeclaration,
  RivetContractLoweringResult,
} from "../../domain/rivet-contract-lowering-result.js";
import type { RivetEndpointExampleValue, RivetType } from "../../domain/rivet-contract.js";
import { bindTypeArguments, type TypeWalkContext } from "./type-walk.js";

/**
 * Type-directed mock source: walks a JSON value alongside the contract type it
 * must satisfy and prints the TS expression that does, so a mock handler can
 * `return` it with no assertion. TS enum values print as member references and
 * brands through rivet-ts's `brand()`; everything else prints as its JSON
 * literal. A value the type rejects is a mismatch naming where it diverges.
 */

/**
 * What the contract's TS source declares that its JSON cannot say: which
 * enums are TS `enum`s, and which `date-time` strings are TS `Date`s.
 */
export type ContractSourceTypes = Pick<
  RivetContractLoweringResult,
  "enumDeclarations" | "dateTypes"
>;

/** A TS enum the printed expression references, and the copied contract module declaring it. */
export type EnumImport = { readonly name: string; readonly relativePath: string };

/** What the printed expression needs in scope. */
export type MockSourceImports = {
  readonly brand: boolean;
  readonly enums: readonly EnumImport[];
};

export type RenderedMockSource =
  | { readonly kind: "rendered"; readonly source: string; readonly imports: MockSourceImports }
  | { readonly kind: "mismatch"; readonly message: string };

type JsonObject = { readonly [key: string]: RivetEndpointExampleValue };

type Expression =
  | { readonly kind: "literal"; readonly value: string | number | boolean | null }
  | { readonly kind: "array"; readonly items: readonly Expression[] }
  | {
      readonly kind: "object";
      readonly entries: readonly { readonly key: string; readonly value: Expression }[];
    }
  | { readonly kind: "brand"; readonly inner: Expression }
  | { readonly kind: "date"; readonly iso: string }
  | { readonly kind: "enumMember"; readonly enum: EnumImport; readonly member: string };

type Mismatch = { readonly kind: "mismatch"; readonly path: string; readonly reason: string };

type RenderContext = TypeWalkContext & {
  readonly enumDeclarations: ReadonlyMap<string, ContractEnumDeclaration>;
  readonly dateTypes: ReadonlySet<RivetType>;
};

export const isJsonObject = (value: RivetEndpointExampleValue): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isJsonArray = (
  value: RivetEndpointExampleValue,
): value is readonly RivetEndpointExampleValue[] => Array.isArray(value);

const mismatch = (path: string, reason: string): Mismatch => ({ kind: "mismatch", path, reason });

const isMismatch = (result: Expression | Mismatch): result is Mismatch =>
  result.kind === "mismatch";

const literal = (value: string | number | boolean | null): Expression => ({
  kind: "literal",
  value,
});

/** A JSON value printed as written, for types that accept any value (`unknown`). */
const jsonExpression = (value: RivetEndpointExampleValue): Expression => {
  if (isJsonArray(value)) {
    return { kind: "array", items: value.map(jsonExpression) };
  }
  if (isJsonObject(value)) {
    return {
      kind: "object",
      entries: Object.entries(value).map(([key, entry]) => ({ key, value: jsonExpression(entry) })),
    };
  }
  return literal(value);
};

const renderProperties = (
  properties: readonly {
    readonly name: string;
    readonly type: RivetType;
    readonly optional?: boolean;
  }[],
  value: RivetEndpointExampleValue,
  path: string,
  context: RenderContext,
): Expression | Mismatch => {
  if (!isJsonObject(value)) {
    return mismatch(path, "expected an object");
  }
  const declared = new Set(properties.map((property) => property.name));
  const unexpected = Object.keys(value).find((key) => !declared.has(key));
  if (unexpected !== undefined) {
    return mismatch(`${path}.${unexpected}`, "is not a property of the type");
  }

  const entries: { key: string; value: Expression }[] = [];
  for (const property of properties) {
    const propertyValue = value[property.name];
    if (propertyValue === undefined) {
      if (property.optional) {
        continue;
      }
      return mismatch(`${path}.${property.name}`, "is required but missing");
    }
    const rendered = render(property.type, propertyValue, `${path}.${property.name}`, context);
    if (isMismatch(rendered)) {
      return rendered;
    }
    entries.push({ key: property.name, value: rendered });
  }
  return { kind: "object", entries };
};

const renderEnum = (
  name: string,
  values: readonly (string | number)[],
  value: RivetEndpointExampleValue,
  path: string,
  context: RenderContext,
): Expression | Mismatch => {
  if ((typeof value !== "string" && typeof value !== "number") || !values.includes(value)) {
    return mismatch(path, `is not a value of enum "${name}"`);
  }
  const declaration = context.enumDeclarations.get(name);
  // An enum-like type alias: its literals are assignable as written.
  if (!declaration) {
    return literal(value);
  }
  const { source } = declaration;
  switch (source.kind) {
    case "outsideContractSources":
      return mismatch(path, `uses enum "${name}", which is declared outside the contract sources`);
    case "ambient":
      return mismatch(path, `uses enum "${name}", a \`declare enum\` with no runtime value`);
    case "module": {
      const member = declaration.members.find((candidate) => candidate.value === value);
      return member
        ? {
            kind: "enumMember",
            enum: { name, relativePath: source.relativePath },
            member: member.name,
          }
        : mismatch(path, `is not a value of enum "${name}"`);
    }
  }
};

const render = (
  type: RivetType,
  value: RivetEndpointExampleValue,
  path: string,
  context: RenderContext,
): Expression | Mismatch => {
  switch (type.kind) {
    case "primitive":
      switch (type.type) {
        case "string":
          if (typeof value !== "string") {
            return mismatch(path, "expected a string");
          }
          if (!context.dateTypes.has(type)) {
            return literal(value);
          }
          return Number.isNaN(Date.parse(value))
            ? mismatch(path, "is not a date")
            : { kind: "date", iso: value };
        case "number":
          return typeof value === "number" ? literal(value) : mismatch(path, "expected a number");
        case "boolean":
          return typeof value === "boolean" ? literal(value) : mismatch(path, "expected a boolean");
        case "unknown":
          return jsonExpression(value);
        case "File":
          return mismatch(path, "is a file, which has no JSON value");
      }

    case "nullable":
      return value === null ? literal(null) : render(type.inner, value, path, context);

    case "array": {
      if (!isJsonArray(value)) {
        return mismatch(path, "expected an array");
      }
      const items: Expression[] = [];
      for (const [index, item] of value.entries()) {
        const rendered = render(type.element, item, `${path}[${index}]`, context);
        if (isMismatch(rendered)) {
          return rendered;
        }
        items.push(rendered);
      }
      return { kind: "array", items };
    }

    case "dictionary": {
      if (!isJsonObject(value)) {
        return mismatch(path, "expected an object");
      }
      const entries: { key: string; value: Expression }[] = [];
      for (const [key, entry] of Object.entries(value)) {
        const rendered = render(type.value, entry, `${path}.${key}`, context);
        if (isMismatch(rendered)) {
          return rendered;
        }
        entries.push({ key, value: rendered });
      }
      return { kind: "object", entries };
    }

    case "stringUnion":
    case "intUnion": {
      const values: readonly (string | number)[] = type.values;
      return (typeof value === "string" || typeof value === "number") && values.includes(value)
        ? literal(value)
        : mismatch(
            path,
            `expected one of ${values.map((entry) => JSON.stringify(entry)).join(", ")}`,
          );
    }

    case "literal":
      return value === type.value
        ? literal(value)
        : mismatch(path, `expected ${JSON.stringify(type.value)}`);

    case "union": {
      let firstMismatch: Mismatch | undefined;
      for (const variant of type.variants) {
        const rendered = render(variant, value, path, context);
        if (!isMismatch(rendered)) {
          return rendered;
        }
        firstMismatch ??= rendered;
      }
      return firstMismatch ?? mismatch(path, "matches no union variant");
    }

    case "ref": {
      const enumValues = context.enumValues.get(type.name);
      if (enumValues) {
        return renderEnum(type.name, enumValues, value, path, context);
      }
      const typeDef = context.typeDefinitions.get(type.name);
      if (!typeDef) {
        return mismatch(path, `references unknown type "${type.name}"`);
      }
      // As in synthesis: with no arguments its type parameters stay unbound,
      // and a nested generic would bind one to itself.
      if (typeDef.typeParameters.length > 0) {
        return mismatch(path, `references generic type "${type.name}" without type arguments`);
      }
      const nested = bindTypeArguments(context, typeDef);
      return typeDef.type
        ? render(typeDef.type, value, path, nested)
        : renderProperties(typeDef.properties, value, path, nested);
    }

    case "generic": {
      const typeDef = context.typeDefinitions.get(type.name);
      if (!typeDef) {
        return mismatch(path, `references unknown generic type "${type.name}"`);
      }
      const nested = bindTypeArguments(context, typeDef, type.typeArgs);
      return typeDef.type
        ? render(typeDef.type, value, path, nested)
        : renderProperties(typeDef.properties, value, path, nested);
    }

    case "typeParam": {
      const substitution = context.substitutions.get(type.name);
      return substitution
        ? render(substitution, value, path, context)
        : mismatch(path, `has unresolved generic type parameter "${type.name}"`);
    }

    case "brand": {
      const inner = render(type.underlying, value, path, context);
      return isMismatch(inner) ? inner : { kind: "brand", inner };
    }

    case "inlineObject":
      return renderProperties(type.properties, value, path, context);

    case "taggedUnion": {
      const tag = isJsonObject(value) ? value[type.discriminator] : undefined;
      const variant = type.variants.find((candidate) => candidate.tag === tag);
      return variant
        ? render(variant.type, value, path, context)
        : mismatch(
            `${path}.${type.discriminator}`,
            `expected one of ${type.variants.map((entry) => JSON.stringify(entry.tag)).join(", ")}`,
          );
    }
  }
};

/**
 * Dotted access for a plain identifier; anything else (`"in-review"`,
 * non-ASCII) is bracketed, which is always valid.
 */
const memberAccess = (enumName: string, member: string): string =>
  /^[A-Za-z_$][\w$]*$/u.test(member)
    ? `${enumName}.${member}`
    : `${enumName}[${JSON.stringify(member)}]`;

/** Prints like `JSON.stringify(value, null, 2)`, which the plain-JSON parts match. */
const print = (expression: Expression, depth: number): string => {
  const pad = "  ".repeat(depth + 1);
  const close = "  ".repeat(depth);
  switch (expression.kind) {
    case "literal":
      return JSON.stringify(expression.value);
    case "brand":
      return `brand(${print(expression.inner, depth)})`;
    case "date":
      return `new Date(${JSON.stringify(expression.iso)})`;
    case "enumMember":
      return memberAccess(expression.enum.name, expression.member);
    case "array":
      return expression.items.length === 0
        ? "[]"
        : `[\n${expression.items.map((item) => `${pad}${print(item, depth + 1)}`).join(",\n")}\n${close}]`;
    case "object":
      return expression.entries.length === 0
        ? "{}"
        : `{\n${expression.entries
            .map(({ key, value }) => `${pad}${JSON.stringify(key)}: ${print(value, depth + 1)}`)
            .join(",\n")}\n${close}}`;
  }
};

const collectImports = (
  expression: Expression,
  imports: { brand: boolean; enums: Map<string, EnumImport> },
): void => {
  switch (expression.kind) {
    case "literal":
    case "date":
      return;
    case "brand":
      imports.brand = true;
      collectImports(expression.inner, imports);
      return;
    case "enumMember":
      imports.enums.set(expression.enum.name, expression.enum);
      return;
    case "array":
      expression.items.forEach((item) => collectImports(item, imports));
      return;
    case "object":
      expression.entries.forEach(({ value }) => collectImports(value, imports));
      return;
  }
};

export const renderMockSource = (
  type: RivetType,
  value: RivetEndpointExampleValue,
  context: TypeWalkContext,
  sourceTypes: ContractSourceTypes,
): RenderedMockSource => {
  const rendered = render(type, value, "response", {
    ...context,
    enumDeclarations: new Map(
      sourceTypes.enumDeclarations.map((declaration) => [declaration.name, declaration]),
    ),
    dateTypes: sourceTypes.dateTypes,
  });
  if (isMismatch(rendered)) {
    return { kind: "mismatch", message: `${rendered.path} ${rendered.reason}` };
  }

  const imports = { brand: false, enums: new Map<string, EnumImport>() };
  collectImports(rendered, imports);
  return {
    kind: "rendered",
    source: print(rendered, 0),
    imports: {
      brand: imports.brand,
      enums: [...imports.enums.values()].sort((left, right) => left.name.localeCompare(right.name)),
    },
  };
};
