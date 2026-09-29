import type {
  RivetContractDocument,
  RivetType,
  RivetTypeDefinition,
} from "../../domain/rivet-contract.js";

/** What a scaffold-time walk over contract types needs to resolve refs, enums and generics. */
export type TypeWalkContext = {
  readonly typeDefinitions: ReadonlyMap<string, RivetTypeDefinition>;
  readonly enumValues: ReadonlyMap<string, readonly (string | number)[]>;
  readonly substitutions: ReadonlyMap<string, RivetType>;
  readonly visiting: ReadonlySet<string>;
};

export const createTypeWalkContext = (document: RivetContractDocument): TypeWalkContext => ({
  typeDefinitions: new Map(document.types.map((typeDef) => [typeDef.name, typeDef])),
  enumValues: new Map(
    document.enums.map((entry) => [entry.name, "values" in entry ? entry.values : entry.intValues]),
  ),
  substitutions: new Map(),
  visiting: new Set(),
});

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

/**
 * The context for walking into `typeDef`. Type arguments are resolved against
 * the outer frame before they are bound, otherwise `Wrapper<T>` inside
 * `Page<T>` binds `T` to itself and the walk never terminates.
 */
export const enterTypeDefinition = <TContext extends TypeWalkContext>(
  context: TContext,
  typeDef: RivetTypeDefinition,
  typeArgs: readonly RivetType[] = [],
): TContext => {
  const substitutions = new Map(context.substitutions);
  for (const [index, typeParameter] of typeDef.typeParameters.entries()) {
    const typeArg = typeArgs[index];
    if (typeArg) {
      substitutions.set(typeParameter, substituteTypeParams(typeArg, context.substitutions));
    }
  }

  return {
    ...context,
    substitutions,
    visiting: new Set([...context.visiting, typeDef.name]),
  };
};
