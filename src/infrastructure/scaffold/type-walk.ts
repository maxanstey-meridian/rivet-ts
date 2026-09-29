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
  /** The type instantiations being walked, outermost first. */
  readonly walking: readonly TypeInstantiation[];
};

/** A type definition with its type arguments resolved in the frame that named them. */
type TypeInstantiation = { readonly name: string; readonly key: string };

export const createTypeWalkContext = (document: RivetContractDocument): TypeWalkContext => ({
  typeDefinitions: new Map(document.types.map((typeDef) => [typeDef.name, typeDef])),
  enumValues: new Map(
    document.enums.map((entry) => [entry.name, "values" in entry ? entry.values : entry.intValues]),
  ),
  substitutions: new Map(),
  walking: [],
});

/**
 * How many instantiations of one definition may nest before the walk treats
 * them as expanding recursion (`Tree<T> = { child: Tree<Box<T>> }` never
 * repeats an instantiation). Real DTOs nest a generic in itself once or twice.
 */
const MAX_NESTED_INSTANTIATIONS = 8;

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
    case "union":
      return {
        ...type,
        variants: type.variants.map((variant) => substituteTypeParams(variant, substitutions)),
      };
    default:
      return type;
  }
};

/**
 * The context for walking into `typeDef`, or `undefined` when that would
 * recurse: the same instantiation is already being walked, or instantiations
 * of `typeDef` keep nesting. Recursion is keyed on the instantiation, so
 * `Box<Box<T>>` walks two different `Box`es. Type arguments are resolved
 * against the outer frame before they are bound, otherwise `Wrapper<T>` inside
 * `Page<T>` binds `T` to itself and the walk never terminates.
 */
export const enterTypeDefinition = <TContext extends TypeWalkContext>(
  context: TContext,
  typeDef: RivetTypeDefinition,
  typeArgs: readonly RivetType[] = [],
): TContext | undefined => {
  const resolvedTypeArgs = typeArgs.map((typeArg) =>
    substituteTypeParams(typeArg, context.substitutions),
  );
  const instantiation = {
    name: typeDef.name,
    key: JSON.stringify([typeDef.name, resolvedTypeArgs]),
  };
  const enclosing = context.walking.filter(({ name }) => name === typeDef.name);
  if (
    enclosing.some(({ key }) => key === instantiation.key) ||
    enclosing.length >= MAX_NESTED_INSTANTIATIONS
  ) {
    return undefined;
  }

  const substitutions = new Map(context.substitutions);
  for (const [index, typeParameter] of typeDef.typeParameters.entries()) {
    const typeArg = resolvedTypeArgs[index];
    if (typeArg) {
      substitutions.set(typeParameter, typeArg);
    }
  }

  return { ...context, substitutions, walking: [...context.walking, instantiation] };
};
