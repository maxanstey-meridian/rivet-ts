import type {
  RivetContractEnum,
  RivetType,
  RivetTypeDefinition,
} from "../../domain/rivet-contract.js";

const needsParensForArray = (type: RivetType): boolean =>
  type.kind === "nullable" ||
  type.kind === "stringUnion" ||
  type.kind === "intUnion" ||
  type.kind === "taggedUnion";

const needsParensForBrand = (type: RivetType): boolean =>
  type.kind === "nullable" ||
  type.kind === "stringUnion" ||
  type.kind === "intUnion" ||
  type.kind === "taggedUnion";

export const emitTypeExpression = (type: RivetType): string => {
  switch (type.kind) {
    case "primitive":
      return type.type;

    case "nullable": {
      const inner = emitTypeExpression(type.inner);
      return `${inner} | null`;
    }

    case "array": {
      const element = emitTypeExpression(type.element);
      if (needsParensForArray(type.element)) {
        return `(${element})[]`;
      }
      return `${element}[]`;
    }

    case "dictionary":
      return `Record<string, ${emitTypeExpression(type.value)}>`;

    case "stringUnion":
      return type.values.map((v) => `"${v}"`).join(" | ");

    case "intUnion":
      return type.values.map((v) => String(v)).join(" | ");

    case "ref":
      return type.name;

    case "generic":
      return `${type.name}<${type.typeArgs.map(emitTypeExpression).join(", ")}>`;

    case "typeParam":
      return type.name;

    case "brand": {
      const underlying = emitTypeExpression(type.underlying);
      const base = needsParensForBrand(type.underlying)
        ? `(${underlying})`
        : underlying;
      return `${base} & { readonly __brand: "${type.name}" }`;
    }

    case "inlineObject": {
      if (type.properties.length === 0) {
        return "{}";
      }
      const props = type.properties
        .map((p) => `  readonly ${p.name}: ${emitTypeExpression(p.type)};`)
        .join("\n");
      return `{\n${props}\n}`;
    }

    case "taggedUnion":
      return type.variants.map((v) => emitTypeExpression(v.type)).join(" | ");
  }
};

const emitTypeParams = (typeParameters: readonly string[]): string => {
  if (typeParameters.length === 0) {
    return "";
  }
  return `<${typeParameters.join(", ")}>`;
};

export const emitTypeDefinition = (typeDef: RivetTypeDefinition): string => {
  const params = emitTypeParams(typeDef.typeParameters);

  if (typeDef.type) {
    return `export type ${typeDef.name}${params} = ${emitTypeExpression(typeDef.type)};`;
  }

  if (typeDef.properties.length === 0) {
    return `export interface ${typeDef.name}${params} {}`;
  }

  const props = typeDef.properties
    .map((p) => {
      const readonlyPrefix = p.readOnly ? "readonly " : "";
      const optional = p.optional ? "?" : "";
      return `  ${readonlyPrefix}${p.name}${optional}: ${emitTypeExpression(p.type)};`;
    })
    .join("\n");

  return `export interface ${typeDef.name}${params} {\n${props}\n}`;
};

export const emitEnumDeclaration = (rivetEnum: RivetContractEnum): string => {
  if ("values" in rivetEnum) {
    const members = rivetEnum.values
      .map((v) => `  ${v} = "${v}"`)
      .join(",\n");
    return `export enum ${rivetEnum.name} {\n${members},\n}`;
  }

  const members = rivetEnum.intValues
    .map((v) => `  Value_${v} = ${v}`)
    .join(",\n");
  return `export enum ${rivetEnum.name} {\n${members},\n}`;
};
