import { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import type {
  RivetContractDocument,
  RivetEndpointDefinition,
  RivetEndpointExampleValue,
  RivetResponseExample,
  RivetType,
  RivetTypeDefinition,
} from "../../domain/rivet-contract.js";

type MockGenerationSuccess =
  | { kind: "value"; value: RivetEndpointExampleValue; needsCast: boolean }
  | { kind: "source"; source: string }
  | { kind: "void" };

type MockGenerationFailure = {
  kind: "todo";
  message: string;
};

export type MockGenerationResult = MockGenerationSuccess | MockGenerationFailure;
type TypeSynthesisResult = Exclude<MockGenerationResult, { kind: "source" }>;

type TypeContext = {
  readonly endpointName: string;
  readonly typeDefinitions: ReadonlyMap<string, RivetTypeDefinition>;
  readonly enumValues: ReadonlyMap<string, readonly (string | number)[]>;
  readonly substitutions: ReadonlyMap<string, RivetType>;
  readonly visiting: ReadonlySet<string>;
  readonly depth: number;
  /** Mutable: set when the synthesized value passes through a TS enum ref or a
   * brand — raw JSON literals are not assignable to either, so the emitted
   * mock body needs an `as <Output>` cast (S7/GAPS 5.1 TS2322 class). */
  readonly state: { needsCast: boolean };
};

/**
 * Conformant mock literals per OpenAPI/Rivet string format. Anything absent
 * falls back to "example" — formats are open-ended on the TS side
 * (`Format<string, "...">` accepts arbitrary strings).
 */
const FORMAT_MOCK_VALUES: Record<string, string> = {
  uuid: "00000000-0000-0000-0000-000000000000",
  "date-time": "2025-01-01T00:00:00.000Z",
  date: "2025-01-01",
  time: "00:00:00",
  duration: "PT1M",
  email: "user@example.com",
  uri: "https://example.com/",
  url: "https://example.com/",
};

/** Backstop against unbounded recursion in mock synthesis; deep real-world DTOs stay far below this. */
const MAX_SYNTHESIS_DEPTH = 64;

const createTypeDefinitions = (
  document: RivetContractDocument,
): ReadonlyMap<string, RivetTypeDefinition> =>
  new Map(document.types.map((typeDef) => [typeDef.name, typeDef]));

const createEnumValues = (
  document: RivetContractDocument,
): ReadonlyMap<string, readonly (string | number)[]> =>
  new Map(
    document.enums.map((entry) => [entry.name, "values" in entry ? entry.values : entry.intValues]),
  );

const findSuccessResponse = (endpoint: RivetEndpointDefinition) =>
  endpoint.responses.find((response) => response.statusCode >= 200 && response.statusCode < 300) ??
  endpoint.responses[0];

const parseExample = (example: RivetResponseExample): RivetEndpointExampleValue | undefined => {
  const rawJson = example.resolvedJson ?? example.json;
  if (!rawJson) {
    return undefined;
  }

  // A malformed stored example must degrade to synthesis, not crash the run (S7).
  try {
    return JSON.parse(rawJson) as RivetEndpointExampleValue;
  } catch {
    return undefined;
  }
};

/**
 * Rewrites every type parameter reference inside `type` using `substitutions`.
 * Type arguments must be resolved against the *outer* frame before being stored
 * for the inner frame; otherwise `Wrapper<T>` inside `Page<T>` maps `T` to the
 * unresolved `typeParam("T")` and mock synthesis recurses forever (S2).
 */
const substituteTypeParams = (
  type: RivetType,
  substitutions: ReadonlyMap<string, RivetType>,
): RivetType => {
  switch (type.kind) {
    case "typeParam":
      return substitutions.get(type.name) ?? type;
    case "nullable":
      return { ...type, inner: substituteTypeParams(type.inner, substitutions) };
    case "array":
      return { ...type, element: substituteTypeParams(type.element, substitutions) };
    case "dictionary":
      return { ...type, value: substituteTypeParams(type.value, substitutions) };
    case "generic":
      return {
        ...type,
        typeArgs: type.typeArgs.map((typeArg) => substituteTypeParams(typeArg, substitutions)),
      };
    case "brand":
      return { ...type, underlying: substituteTypeParams(type.underlying, substitutions) };
    case "inlineObject":
      return {
        ...type,
        properties: type.properties.map((property) => ({
          ...property,
          type: substituteTypeParams(property.type, substitutions),
        })),
      };
    case "taggedUnion":
      return {
        ...type,
        variants: type.variants.map((variant) => ({
          ...variant,
          type: substituteTypeParams(variant.type, substitutions),
        })),
      };
    default:
      return type;
  }
};

const withSubstitutions = (
  context: TypeContext,
  typeDef: RivetTypeDefinition,
  typeArgs: readonly RivetType[],
): ReadonlyMap<string, RivetType> => {
  const substitutions = new Map(context.substitutions);

  for (const [index, typeParameter] of typeDef.typeParameters.entries()) {
    const typeArg = typeArgs[index];
    if (typeArg) {
      substitutions.set(typeParameter, substituteTypeParams(typeArg, context.substitutions));
    }
  }

  return substitutions;
};

const withVisiting = (context: TypeContext, name: string): ReadonlySet<string> => {
  const visiting = new Set(context.visiting);
  visiting.add(name);
  return visiting;
};

const synthesizeObject = (
  properties: readonly {
    readonly name: string;
    readonly type: RivetType;
    readonly optional?: boolean;
  }[],
  context: TypeContext,
): TypeSynthesisResult => {
  const output: Record<string, RivetEndpointExampleValue> = {};

  for (const property of properties) {
    const value = synthesizeType(property.type, context);
    if (value.kind === "todo") {
      if (property.optional) {
        continue;
      }
      return value;
    }
    if (value.kind === "value") {
      output[property.name] = value.value;
    }
  }

  return { kind: "value", value: output, needsCast: false };
};

const synthesizeTaggedUnion = (
  type: Extract<RivetType, { kind: "taggedUnion" }>,
  context: TypeContext,
): TypeSynthesisResult => {
  const [firstVariant] = type.variants;
  if (!firstVariant) {
    return {
      kind: "todo",
      message: `Endpoint "${context.endpointName}" has an empty tagged union.`,
    };
  }

  const value = synthesizeType(firstVariant.type, context);
  if (value.kind === "todo") {
    return value;
  }

  const objectValue =
    value.kind === "value" && value.value !== null && !Array.isArray(value.value)
      ? (value.value as Record<string, RivetEndpointExampleValue>)
      : {};

  return {
    kind: "value",
    value: {
      ...objectValue,
      [type.discriminator]: firstVariant.tag,
    },
    needsCast: false,
  };
};

const synthesizeType = (type: RivetType, outerContext: TypeContext): TypeSynthesisResult => {
  if (outerContext.depth >= MAX_SYNTHESIS_DEPTH) {
    return {
      kind: "todo",
      message: `Endpoint "${outerContext.endpointName}" has a response type nested too deeply for scaffold-mock to synthesize.`,
    };
  }

  const context: TypeContext = { ...outerContext, depth: outerContext.depth + 1 };

  switch (type.kind) {
    case "primitive":
      switch (type.type) {
        case "string": {
          const formatted = type.format ? FORMAT_MOCK_VALUES[type.format] : undefined;
          if (formatted !== undefined) {
            return { kind: "value", value: formatted, needsCast: false };
          }
          return { kind: "value", value: "example", needsCast: false };
        }
        case "number":
          return { kind: "value", value: 0, needsCast: false };
        case "boolean":
          return { kind: "value", value: false, needsCast: false };
        case "unknown":
          return {
            kind: "todo",
            message: `Endpoint "${context.endpointName}" uses unsupported primitive type "unknown".`,
          };
        case "File":
          return {
            kind: "todo",
            message: `Endpoint "${context.endpointName}" returns a file response, which scaffold-mock does not synthesize in v1.`,
          };
      }

    case "nullable": {
      const inner = synthesizeType(type.inner, context);
      return inner.kind === "todo" ? { kind: "value", value: null, needsCast: false } : inner;
    }

    case "array": {
      const element = synthesizeType(type.element, context);
      if (element.kind === "todo") {
        return { kind: "value", value: [], needsCast: false };
      }
      return {
        kind: "value",
        value: element.kind === "void" ? [] : [element.value],
        needsCast: false,
      };
    }

    case "dictionary": {
      const value = synthesizeType(type.value, context);
      if (value.kind === "todo") {
        return { kind: "value", value: {}, needsCast: false };
      }
      // An empty dictionary is assignable to Record<string, T> for every T;
      // {key: null} is not (S7).
      return {
        kind: "value",
        value: value.kind === "void" ? {} : { key: value.value },
        needsCast: false,
      };
    }

    case "stringUnion":
      if (type.values.length === 0) {
        return {
          kind: "todo",
          message: `Endpoint "${context.endpointName}" uses an empty string union.`,
        };
      }
      return { kind: "value", value: type.values[0], needsCast: false };

    case "intUnion":
      if (type.values.length === 0) {
        return {
          kind: "todo",
          message: `Endpoint "${context.endpointName}" uses an empty int union.`,
        };
      }
      return { kind: "value", value: type.values[0], needsCast: false };

    case "literal":
      return { kind: "value", value: type.value, needsCast: false };

    case "union": {
      for (const variant of type.variants) {
        const result = synthesizeType(variant, context);
        if (result.kind !== "todo") {
          return result;
        }
      }
      return {
        kind: "todo",
        message: `Endpoint "${context.endpointName}" has no synthesizable union variant.`,
      };
    }

    case "ref": {
      const enumValues = context.enumValues.get(type.name);
      if (enumValues) {
        if (enumValues.length === 0) {
          return {
            kind: "todo",
            message: `Endpoint "${context.endpointName}" references empty enum "${type.name}".`,
          };
        }
        context.state.needsCast = true;
        return { kind: "value", value: enumValues[0] as string | number, needsCast: true };
      }

      const typeDef = context.typeDefinitions.get(type.name);
      if (!typeDef) {
        return {
          kind: "todo",
          message: `Endpoint "${context.endpointName}" references unknown type "${type.name}".`,
        };
      }

      if (context.visiting.has(type.name)) {
        return {
          kind: "todo",
          message: `Endpoint "${context.endpointName}" references recursive type "${type.name}", which scaffold-mock does not synthesize in v1.`,
        };
      }

      if (typeDef.typeParameters.length > 0) {
        return {
          kind: "todo",
          message: `Endpoint "${context.endpointName}" references generic type "${type.name}" without type arguments.`,
        };
      }

      const nestedContext: TypeContext = {
        ...context,
        visiting: withVisiting(context, type.name),
      };

      if (typeDef.type) {
        return synthesizeType(typeDef.type, nestedContext);
      }

      return synthesizeObject(typeDef.properties, nestedContext);
    }

    case "generic": {
      const typeDef = context.typeDefinitions.get(type.name);
      if (!typeDef) {
        return {
          kind: "todo",
          message: `Endpoint "${context.endpointName}" references unknown generic type "${type.name}".`,
        };
      }

      if (context.visiting.has(type.name)) {
        return {
          kind: "todo",
          message: `Endpoint "${context.endpointName}" references recursive generic type "${type.name}", which scaffold-mock does not synthesize in v1.`,
        };
      }

      const nestedContext: TypeContext = {
        ...context,
        substitutions: withSubstitutions(context, typeDef, type.typeArgs),
        visiting: withVisiting(context, type.name),
      };

      if (typeDef.type) {
        return synthesizeType(typeDef.type, nestedContext);
      }

      return synthesizeObject(typeDef.properties, nestedContext);
    }

    case "typeParam": {
      const substitution = context.substitutions.get(type.name);
      if (!substitution) {
        return {
          kind: "todo",
          message: `Endpoint "${context.endpointName}" has unresolved generic type parameter "${type.name}".`,
        };
      }

      return synthesizeType(substitution, context);
    }

    case "brand":
      context.state.needsCast = true;
      return synthesizeType(type.underlying, context);

    case "inlineObject":
      return synthesizeObject(type.properties, context);

    case "taggedUnion":
      return synthesizeTaggedUnion(type, context);
  }
};

export const generateEndpointMock = (
  endpoint: RivetEndpointDefinition,
  document: RivetContractDocument,
): { result: MockGenerationResult; diagnostics: readonly ExtractionDiagnostic[] } => {
  const successResponse = findSuccessResponse(endpoint);
  const diagnostics: ExtractionDiagnostic[] = [];

  if (endpoint.fileContentType) {
    return {
      result: {
        kind: "source",
        source: `new Blob(["example"], { type: ${JSON.stringify(endpoint.fileContentType)} })`,
      },
      diagnostics,
    };
  }

  const firstExample = successResponse?.examples?.[0];
  if (firstExample) {
    const parsed = parseExample(firstExample);
    if (parsed !== undefined) {
      // Example-backed mocks are emitted verbatim with no conformance check
      // against the response type, so they always cast (S7).
      return {
        result: { kind: "value", value: parsed, needsCast: true },
        diagnostics,
      };
    }
  }

  const responseType = successResponse?.dataType ?? endpoint.returnType;
  if (!responseType) {
    return {
      result: { kind: "void" },
      diagnostics,
    };
  }

  const state = { needsCast: false };
  const synthesized = synthesizeType(responseType, {
    endpointName: endpoint.name,
    typeDefinitions: createTypeDefinitions(document),
    enumValues: createEnumValues(document),
    substitutions: new Map(),
    visiting: new Set(),
    depth: 0,
    state,
  });
  const result: MockGenerationResult =
    synthesized.kind === "value" ? { ...synthesized, needsCast: state.needsCast } : synthesized;

  if (result.kind === "todo") {
    diagnostics.push(
      new ExtractionDiagnostic({
        severity: "warning",
        code: "SCAFFOLD_UNSUPPORTED_RESPONSE_SHAPE",
        message: result.message,
      }),
    );
  }

  return { result, diagnostics };
};
