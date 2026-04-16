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
  | { kind: "value"; value: RivetEndpointExampleValue }
  | { kind: "void" };

type MockGenerationFailure = {
  kind: "todo";
  message: string;
};

export type MockGenerationResult = MockGenerationSuccess | MockGenerationFailure;

type TypeContext = {
  readonly endpointName: string;
  readonly typeDefinitions: ReadonlyMap<string, RivetTypeDefinition>;
  readonly enumValues: ReadonlyMap<string, readonly (string | number)[]>;
  readonly substitutions: ReadonlyMap<string, RivetType>;
  readonly visiting: ReadonlySet<string>;
};

const createTypeDefinitions = (
  document: RivetContractDocument,
): ReadonlyMap<string, RivetTypeDefinition> =>
  new Map(document.types.map((typeDef) => [typeDef.name, typeDef]));

const createEnumValues = (
  document: RivetContractDocument,
): ReadonlyMap<string, readonly (string | number)[]> =>
  new Map(
    document.enums.map((entry) => [
      entry.name,
      "values" in entry ? entry.values : entry.intValues,
    ]),
  );

const findSuccessResponse = (endpoint: RivetEndpointDefinition) =>
  endpoint.responses.find((response) => response.statusCode >= 200 && response.statusCode < 300)
  ?? endpoint.responses[0];

const parseExample = (
  example: RivetResponseExample,
): RivetEndpointExampleValue | undefined => {
  const rawJson = example.resolvedJson ?? example.json;
  if (!rawJson) {
    return undefined;
  }

  return JSON.parse(rawJson) as RivetEndpointExampleValue;
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
      substitutions.set(typeParameter, typeArg);
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
  }[],
  context: TypeContext,
): MockGenerationResult => {
  const output: Record<string, RivetEndpointExampleValue> = {};

  for (const property of properties) {
    const value = synthesizeType(property.type, context);
    if (value.kind === "todo") {
      return value;
    }
    if (value.kind === "value") {
      output[property.name] = value.value;
    }
  }

  return { kind: "value", value: output };
};

const synthesizeTaggedUnion = (
  type: Extract<RivetType, { kind: "taggedUnion" }>,
  context: TypeContext,
): MockGenerationResult => {
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
  };
};

const synthesizeType = (type: RivetType, context: TypeContext): MockGenerationResult => {
  switch (type.kind) {
    case "primitive":
      switch (type.type) {
        case "string":
          if (type.format === "uuid") {
            return { kind: "value", value: "00000000-0000-0000-0000-000000000000" };
          }
          if (type.format === "date-time") {
            return { kind: "value", value: "2025-01-01T00:00:00.000Z" };
          }
          return { kind: "value", value: "example" };
        case "number":
          return { kind: "value", value: 0 };
        case "boolean":
          return { kind: "value", value: false };
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
      return inner.kind === "todo" ? { kind: "value", value: null } : inner;
    }

    case "array": {
      const element = synthesizeType(type.element, context);
      if (element.kind === "todo") {
        return element;
      }
      return {
        kind: "value",
        value: element.kind === "void" ? [] : [element.value],
      };
    }

    case "dictionary": {
      const value = synthesizeType(type.value, context);
      if (value.kind === "todo") {
        return value;
      }
      return {
        kind: "value",
        value: {
          key: value.kind === "void" ? null : value.value,
        },
      };
    }

    case "stringUnion":
      if (type.values.length === 0) {
        return {
          kind: "todo",
          message: `Endpoint "${context.endpointName}" uses an empty string union.`,
        };
      }
      return { kind: "value", value: type.values[0] };

    case "intUnion":
      if (type.values.length === 0) {
        return {
          kind: "todo",
          message: `Endpoint "${context.endpointName}" uses an empty int union.`,
        };
      }
      return { kind: "value", value: type.values[0] };

    case "ref": {
      const enumValues = context.enumValues.get(type.name);
      if (enumValues) {
        if (enumValues.length === 0) {
          return {
            kind: "todo",
            message: `Endpoint "${context.endpointName}" references empty enum "${type.name}".`,
          };
        }
        return { kind: "value", value: enumValues[0] as string | number };
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

  const firstExample = successResponse?.examples?.[0];
  if (firstExample) {
    const parsed = parseExample(firstExample);
    if (parsed !== undefined) {
      return {
        result: { kind: "value", value: parsed },
        diagnostics,
      };
    }
  }

  if (endpoint.fileContentType) {
    const message = `Endpoint "${endpoint.name}" returns a file response, which scaffold-mock does not synthesize in v1.`;
    diagnostics.push(
      new ExtractionDiagnostic({
        severity: "warning",
        code: "SCAFFOLD_UNSUPPORTED_FILE_RESPONSE",
        message,
      }),
    );
    return {
      result: { kind: "todo", message },
      diagnostics,
    };
  }

  const responseType = successResponse?.dataType ?? endpoint.returnType;
  if (!responseType) {
    return {
      result: { kind: "void" },
      diagnostics,
    };
  }

  const result = synthesizeType(responseType, {
    endpointName: endpoint.name,
    typeDefinitions: createTypeDefinitions(document),
    enumValues: createEnumValues(document),
    substitutions: new Map(),
    visiting: new Set(),
  });

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
