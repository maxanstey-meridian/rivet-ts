// TypeScript type nodes and named declarations to contract-JSON types and enums.
import ts from "typescript";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import {
  RivetTypeDefinition,
  type RivetContractEnum,
  type RivetPropertyDefinition,
  type RivetType,
} from "../../domain/rivet-contract.js";
import {
  createNodeDiagnostic,
  getPropertyName,
  hasModifier,
  isListTypeName,
  isNullTypeNode,
  isPresent,
  isRivetSymbol,
  libraryTypeName,
  readLiteral,
  readStringLiteral,
  resolveSymbol,
  resolveTypeName,
  type LiteralValue,
  type LoweringContext,
  type PropertyDescriptor,
} from "./authoring-syntax.js";

export const collectTypeReferences = (type: RivetType, references: Set<string>): void => {
  switch (type.kind) {
    case "array":
      collectTypeReferences(type.element, references);
      return;
    case "brand":
      collectTypeReferences(type.underlying, references);
      return;
    case "dictionary":
      collectTypeReferences(type.value, references);
      return;
    case "generic":
      references.add(type.name);
      for (const typeArg of type.typeArgs) {
        collectTypeReferences(typeArg, references);
      }
      return;
    case "inlineObject":
      for (const property of type.properties) {
        collectTypeReferences(property.type, references);
      }
      return;
    case "taggedUnion":
      for (const variant of type.variants) {
        collectTypeReferences(variant.type, references);
      }
      return;
    case "union":
      for (const variant of type.variants) {
        collectTypeReferences(variant, references);
      }
      return;
    case "nullable":
      collectTypeReferences(type.inner, references);
      return;
    case "ref":
      references.add(type.name);
      return;
    case "intUnion":
    case "literal":
    case "primitive":
    case "stringUnion":
    case "typeParam":
      return;
  }
};

export const getDefinitionReferences = (definition: RivetTypeDefinition): string[] => {
  const references = new Set<string>();
  if (definition.type) {
    collectTypeReferences(definition.type, references);
  }
  for (const property of definition.properties) {
    collectTypeReferences(property.type, references);
  }
  references.delete(definition.name);
  return [...references].sort();
};

export const lowerNamedDeclaration = (
  ctx: LoweringContext,
  name: string,
): RivetContractEnum | RivetTypeDefinition | null => {
  const declaration = ctx.declarations.get(name);
  if (!declaration) {
    ctx.diagnostics.push(
      new ExtractionDiagnostic({
        severity: "error",
        code: "TYPE_NOT_FOUND",
        message: `Could not resolve referenced type "${name}".`,
      }),
    );
    return null;
  }

  if (ts.isEnumDeclaration(declaration)) {
    return lowerEnumDeclaration(ctx, declaration);
  }

  if (ts.isTypeAliasDeclaration(declaration)) {
    const enumLikeAlias = lowerEnumLikeTypeAlias(ctx, declaration);
    if (enumLikeAlias) {
      return enumLikeAlias;
    }
  }

  return lowerTypeDefinition(ctx, declaration);
};

const nextAutoNumber = (index: number, previous: string | number | undefined): number | undefined =>
  index === 0 ? 0 : typeof previous === "number" ? previous + 1 : undefined;

const lowerEnumDeclaration = (
  ctx: LoweringContext,
  declaration: ts.EnumDeclaration,
): RivetContractEnum | null => {
  const name = declaration.name.text;
  const stringValues: string[] = [];
  const intValues: number[] = [];
  let previous: string | number | undefined;
  for (const [index, member] of declaration.members.entries()) {
    // The checker has no constant value for an uninitialised member of an
    // ambient (`declare`) enum; it still numbers on from the previous member.
    const value =
      ctx.checker.getConstantValue(member) ??
      (member.initializer === undefined ? nextAutoNumber(index, previous) : undefined);
    if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) {
      ctx.diagnostics.push(
        createNodeDiagnostic(
          member,
          "UNSUPPORTED_ENUM_MEMBER",
          `Enum "${name}" must use members with constant string or finite numeric values.`,
        ),
      );
      return null;
    }
    previous = value;

    if (typeof value === "string") {
      stringValues.push(value);
    } else {
      intValues.push(value);
    }
  }

  if (stringValues.length > 0 && intValues.length > 0) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        declaration.name,
        "MIXED_ENUM_TYPES",
        `Enum "${name}" cannot mix string and numeric members.`,
      ),
    );
    return null;
  }

  return stringValues.length > 0 ? { name, values: stringValues } : { name, intValues };
};

const lowerEnumLikeTypeAlias = (
  ctx: LoweringContext,
  declaration: ts.TypeAliasDeclaration,
): RivetContractEnum | null => {
  if (!ts.isUnionTypeNode(declaration.type)) {
    return null;
  }

  const literalUnion = readLiteralUnion(ctx, declaration.type.types);
  if (!literalUnion) {
    return null;
  }

  const name = declaration.name.text;
  return literalUnion.kind === "string"
    ? { name, values: literalUnion.values }
    : { name, intValues: literalUnion.values };
};

const lowerTypeDefinition = (
  ctx: LoweringContext,
  declaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
): RivetTypeDefinition | null => {
  const name = declaration.name.text;
  const typeParameters = declaration.typeParameters?.map((parameter) => parameter.name.text) ?? [];
  const scope = new Set(typeParameters);

  let descriptors: PropertyDescriptor[] | null;
  if (ts.isInterfaceDeclaration(declaration)) {
    descriptors = readInterfaceProperties(ctx, declaration, `Type "${name}"`);
  } else if (ts.isTypeLiteralNode(declaration.type)) {
    descriptors = readPropertyMembers(ctx, declaration.type.members, `Type "${name}"`);
  } else {
    const type = lowerTypeNode(ctx, declaration.type, scope);
    return type ? new RivetTypeDefinition({ name, typeParameters, type }) : null;
  }

  const properties = descriptors && lowerProperties(ctx, descriptors, scope);
  return properties ? new RivetTypeDefinition({ name, typeParameters, properties }) : null;
};

const lowerProperties = (
  ctx: LoweringContext,
  descriptors: readonly PropertyDescriptor[],
  scope: Set<string>,
): RivetPropertyDefinition[] | null => {
  const properties: RivetPropertyDefinition[] = [];
  for (const descriptor of descriptors) {
    const type = lowerTypeNode(ctx, descriptor.typeNode, scope);
    if (!type) {
      return null;
    }

    properties.push({
      name: descriptor.name,
      type,
      optional: descriptor.optional,
      readOnly: descriptor.readOnly || undefined,
    });
  }

  return properties;
};

// Inline objects carry `optional` only when it is true or the type is
// nullable, so `x?: T`, `x: T | null` and `x?: T | null` stay distinct.
const lowerInlineObject = (
  ctx: LoweringContext,
  descriptors: readonly PropertyDescriptor[],
  scope: Set<string>,
): RivetType | null => {
  const properties = lowerProperties(ctx, descriptors, scope);
  return properties
    ? {
        kind: "inlineObject",
        properties: properties.map(({ name, type, optional }) => ({
          name,
          type,
          ...(optional || type.kind === "nullable" ? { optional } : {}),
        })),
      }
    : null;
};

// Flattens the inheritance chain (own members override inherited ones by
// name), or fails when a base is not a supported local interface.
const readInterfaceProperties = (
  ctx: LoweringContext,
  declaration: ts.InterfaceDeclaration,
  contextLabel: string,
  seen: Set<ts.InterfaceDeclaration> = new Set(),
): PropertyDescriptor[] | null => {
  if (seen.has(declaration)) {
    return [];
  }
  seen.add(declaration);

  const inherited: PropertyDescriptor[] = [];
  for (const clause of declaration.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
      continue;
    }

    for (const type of clause.types) {
      const baseDeclaration = resolveHeritageInterface(ctx, type);
      if (!baseDeclaration || (type.typeArguments?.length ?? 0) > 0) {
        ctx.diagnostics.push(
          createNodeDiagnostic(
            type,
            "UNSUPPORTED_HERITAGE_CLAUSE",
            `${contextLabel} extends "${type.getText()}", which is not a supported base type. Only exported, non-generic local interfaces can be inherited.`,
          ),
        );
        return null;
      }

      const baseProperties = readInterfaceProperties(ctx, baseDeclaration, contextLabel, seen);
      if (!baseProperties) {
        return null;
      }

      inherited.push(...baseProperties);
    }
  }

  const ownProperties = readPropertyMembers(ctx, declaration.members, contextLabel);
  if (!ownProperties) {
    return null;
  }

  const overriddenNames = new Set(ownProperties.map((property) => property.name));
  const merged = new Map<string, PropertyDescriptor>();
  for (const property of inherited) {
    if (!overriddenNames.has(property.name)) {
      merged.set(property.name, property);
    }
  }

  return [...merged.values(), ...ownProperties];
};

const resolveHeritageInterface = (
  ctx: LoweringContext,
  type: ts.ExpressionWithTypeArguments,
): ts.InterfaceDeclaration | null => {
  const name = resolveSymbol(ctx.checker, type.expression)?.getName();
  const declaration = name ? ctx.declarations.get(name) : undefined;
  return declaration && ts.isInterfaceDeclaration(declaration) ? declaration : null;
};

const readPropertyMembers = (
  ctx: LoweringContext,
  members: ts.NodeArray<ts.TypeElement>,
  contextLabel: string,
): PropertyDescriptor[] | null => {
  const properties: PropertyDescriptor[] = [];
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.type || !member.name) {
      ctx.diagnostics.push(
        createNodeDiagnostic(
          member,
          "UNSUPPORTED_OBJECT_MEMBER",
          `${contextLabel} may only contain property signatures.`,
        ),
      );
      return null;
    }

    const propertyName = getPropertyName(member.name);
    if (!propertyName) {
      ctx.diagnostics.push(
        createNodeDiagnostic(
          member.name,
          "UNSUPPORTED_PROPERTY_NAME",
          `${contextLabel} contains a property with an unsupported name.`,
        ),
      );
      return null;
    }

    // `T | undefined` is the union spelling of an optional property: record
    // the optionality and lower the defined member directly when only one
    // remains (lowerUnionTypeNode drops undefined otherwise).
    let typeNode = member.type;
    let optional = Boolean(member.questionToken);
    if (ts.isUnionTypeNode(typeNode)) {
      const definedMembers = typeNode.types.filter(
        (unionMember) => unionMember.kind !== ts.SyntaxKind.UndefinedKeyword,
      );
      if (definedMembers.length < typeNode.types.length) {
        optional = true;
        if (definedMembers.length === 1) {
          [typeNode] = definedMembers;
        }
      }
    }

    properties.push({
      name: propertyName,
      typeNode,
      optional,
      readOnly: hasModifier(member, ts.ModifierFlags.Readonly),
    });
  }

  return properties;
};

export const getObjectProperties = (
  ctx: LoweringContext,
  inputNode: ts.TypeNode,
): PropertyDescriptor[] | null => {
  if (ts.isTypeLiteralNode(inputNode)) {
    return readPropertyMembers(ctx, inputNode.members, "Inline object");
  }

  if (!ts.isTypeReferenceNode(inputNode) || inputNode.typeArguments?.length) {
    return null;
  }

  const name = resolveTypeName(ctx, inputNode.typeName);
  const declaration = ctx.declarations.get(name);
  if (!declaration) {
    return null;
  }

  if (ts.isInterfaceDeclaration(declaration)) {
    return readInterfaceProperties(ctx, declaration, `Type "${name}"`);
  }

  if (ts.isTypeAliasDeclaration(declaration) && ts.isTypeLiteralNode(declaration.type)) {
    return readPropertyMembers(ctx, declaration.type.members, `Type "${name}"`);
  }

  return null;
};

export const getTypeParameterScope = (ctx: LoweringContext, node: ts.TypeNode): Set<string> => {
  if (!ts.isTypeReferenceNode(node) || !node.typeArguments?.length) {
    return new Set<string>();
  }

  const name = resolveTypeName(ctx, node.typeName);
  const declaration = ctx.declarations.get(name);
  if (
    !declaration ||
    (!ts.isInterfaceDeclaration(declaration) && !ts.isTypeAliasDeclaration(declaration))
  ) {
    return new Set<string>();
  }

  const parameters = declaration.typeParameters?.map((parameter) => parameter.name.text) ?? [];
  return new Set(parameters);
};

export const lowerOptionalTypeNode = (
  ctx: LoweringContext,
  node: ts.TypeNode | undefined,
): RivetType | null => {
  if (!node || node.kind === ts.SyntaxKind.VoidKeyword) {
    return null;
  }

  return lowerTypeNode(ctx, node, new Set<string>());
};

export const lowerTypeNode = (
  ctx: LoweringContext,
  node: ts.TypeNode,
  typeParameters: Set<string>,
): RivetType | null => {
  if (ts.isParenthesizedTypeNode(node)) {
    return lowerTypeNode(ctx, node.type, typeParameters);
  }

  if (ts.isArrayTypeNode(node)) {
    const elementType = lowerTypeNode(ctx, node.elementType, typeParameters);
    return elementType
      ? {
          kind: "array",
          element: elementType,
        }
      : null;
  }

  if (ts.isTypeLiteralNode(node)) {
    const properties = readPropertyMembers(ctx, node.members, "Inline object");
    return properties && lowerInlineObject(ctx, properties, typeParameters);
  }

  if (ts.isTypeReferenceNode(node)) {
    return lowerTypeReferenceNode(ctx, node, typeParameters);
  }

  if (ts.isUnionTypeNode(node)) {
    return lowerUnionTypeNode(ctx, node, typeParameters);
  }

  const literal = readLiteralTypeNode(ctx, node);
  if (typeof literal === "string") {
    return { kind: "stringUnion", values: [literal] };
  }

  if (typeof literal === "number") {
    return { kind: "intUnion", values: [literal] };
  }

  if (typeof literal === "boolean") {
    return { kind: "literal", value: literal };
  }

  switch (node.kind) {
    case ts.SyntaxKind.BooleanKeyword:
      return {
        kind: "primitive",
        type: "boolean",
      };
    case ts.SyntaxKind.NumberKeyword:
      return {
        kind: "primitive",
        type: "number",
      };
    case ts.SyntaxKind.StringKeyword:
      return {
        kind: "primitive",
        type: "string",
      };
    case ts.SyntaxKind.UnknownKeyword:
      return {
        kind: "primitive",
        type: "unknown",
      };
  }

  if (isNullTypeNode(node)) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        node,
        "UNSUPPORTED_NULL_TYPE",
        "Standalone null types are not supported. Use a nullable union such as T | null.",
      ),
    );
    return null;
  }

  ctx.diagnostics.push(
    createNodeDiagnostic(
      node,
      "UNSUPPORTED_TYPE_EXPRESSION",
      `Unsupported type expression "${node.getText()}".`,
    ),
  );
  return null;
};

const lowerTypeReferenceNode = (
  ctx: LoweringContext,
  node: ts.TypeReferenceNode,
  typeParameters: Set<string>,
): RivetType | null => {
  const typeName = resolveTypeName(ctx, node.typeName);
  const libraryName = libraryTypeName(ctx, node.typeName);
  const typeArguments = node.typeArguments ?? [];

  if (isListTypeName(libraryName)) {
    const [elementNode] = typeArguments;
    if (!elementNode) {
      ctx.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_ARRAY_TYPE",
          `${typeName}<T> must declare an element type.`,
        ),
      );
      return null;
    }

    const elementType = lowerTypeNode(ctx, elementNode, typeParameters);
    return elementType
      ? {
          kind: "array",
          element: elementType,
        }
      : null;
  }

  if (libraryName === "Record") {
    const [keyNode, valueNode] = typeArguments;
    if (!keyNode || !valueNode || !isStringLikeRecordKey(ctx, keyNode)) {
      ctx.diagnostics.push(
        createNodeDiagnostic(
          node,
          "UNSUPPORTED_RECORD_KEY",
          "Only Record<string, T> is supported.",
        ),
      );
      return null;
    }

    const valueType = lowerTypeNode(ctx, valueNode, typeParameters);
    return valueType
      ? {
          kind: "dictionary",
          value: valueType,
        }
      : null;
  }

  if (isRivetSymbol(ctx.checker, node.typeName, "Brand")) {
    const [underlyingNode, brandNameNode] = typeArguments;
    const brandName = brandNameNode ? readStringLiteral(ctx, brandNameNode) : null;
    if (!underlyingNode || !brandName) {
      ctx.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_BRAND",
          'Brand<T, "Name"> must declare an underlying type and string literal brand name.',
        ),
      );
      return null;
    }

    const underlyingType = lowerTypeNode(ctx, underlyingNode, typeParameters);
    return underlyingType
      ? {
          kind: "brand",
          name: brandName,
          underlying: underlyingType,
        }
      : null;
  }

  if (isRivetSymbol(ctx.checker, node.typeName, "Format")) {
    const [underlyingNode, formatNode] = typeArguments;
    const format = formatNode ? readStringLiteral(ctx, formatNode) : null;
    if (!underlyingNode || !format) {
      ctx.diagnostics.push(
        createNodeDiagnostic(
          node,
          "INVALID_FORMAT",
          'Format<T, "name"> must declare an underlying type and string literal format.',
        ),
      );
      return null;
    }

    const underlyingType = lowerTypeNode(ctx, underlyingNode, typeParameters);
    if (!underlyingType) {
      return null;
    }

    if (underlyingType.kind !== "primitive") {
      ctx.diagnostics.push(
        createNodeDiagnostic(
          node,
          "UNSUPPORTED_FORMAT_TARGET",
          'Format<T, "name"> currently only supports primitive underlying types.',
        ),
      );
      return null;
    }

    return {
      ...underlyingType,
      format,
    };
  }

  // Date lives in lib .d.ts files the declaration index never sees, so a
  // bare ref would dangle; lower it to its wire shape instead.
  if (libraryName === "Date" && typeArguments.length === 0) {
    return {
      kind: "primitive",
      type: "string",
      format: "date-time",
    };
  }

  if (typeParameters.has(typeName) && typeArguments.length === 0) {
    return {
      kind: "typeParam",
      name: typeName,
    };
  }

  if (typeArguments.length === 0) {
    return {
      kind: "ref",
      name: typeName,
    };
  }

  const loweredTypeArgs = [];
  for (const typeArgument of typeArguments) {
    const loweredTypeArg = lowerTypeNode(ctx, typeArgument, typeParameters);
    if (!loweredTypeArg) {
      return null;
    }

    loweredTypeArgs.push(loweredTypeArg);
  }

  return {
    kind: "generic",
    name: typeName,
    typeArgs: loweredTypeArgs,
  };
};

const lowerUnionTypeNode = (
  ctx: LoweringContext,
  node: ts.UnionTypeNode,
  typeParameters: Set<string>,
): RivetType | null => {
  // `undefined` carries no JSON meaning beyond optionality, which
  // readPropertyMembers records.
  const definedMembers = node.types.filter(
    (member) => member.kind !== ts.SyntaxKind.UndefinedKeyword,
  );
  const nonNullMembers = definedMembers.filter((member) => !isNullTypeNode(member));
  const isNullable = nonNullMembers.length !== definedMembers.length;

  if (nonNullMembers.length === 0) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        node,
        "UNSUPPORTED_UNION",
        `Union "${node.getText()}" is not supported.`,
      ),
    );
    return null;
  }

  const [onlyMember] = nonNullMembers;
  const loweredMembers =
    nonNullMembers.length === 1
      ? lowerTypeNode(ctx, onlyMember, typeParameters)
      : lowerUnionMembers(ctx, node, nonNullMembers, typeParameters);
  if (!loweredMembers) {
    return null;
  }

  return isNullable
    ? {
        kind: "nullable",
        inner: loweredMembers,
      }
    : loweredMembers;
};

const lowerUnionMembers = (
  ctx: LoweringContext,
  node: ts.UnionTypeNode,
  members: readonly ts.TypeNode[],
  typeParameters: Set<string>,
): RivetType | null => {
  const taggedUnion = tryLowerTaggedUnionTypeNode(ctx, node, members, typeParameters);
  if (taggedUnion) {
    return taggedUnion;
  }

  const literalUnion = readLiteralUnion(ctx, members);
  if (literalUnion) {
    return literalUnion.kind === "string"
      ? { kind: "stringUnion", values: literalUnion.values }
      : { kind: "intUnion", values: literalUnion.values };
  }

  if (!members.every((member) => isScalarUnionMember(member))) {
    ctx.diagnostics.push(
      createNodeDiagnostic(
        node,
        "UNSUPPORTED_UNION",
        `Union "${node.getText()}" is not supported.`,
      ),
    );
    return null;
  }

  const variants = members.map((member) => lowerUnionVariant(ctx, member, typeParameters));
  return variants.every(isPresent) ? { kind: "union", variants } : null;
};

const isScalarUnionMember = (member: ts.TypeNode): boolean => {
  return (
    ts.isLiteralTypeNode(member) ||
    member.kind === ts.SyntaxKind.BooleanKeyword ||
    member.kind === ts.SyntaxKind.NumberKeyword ||
    member.kind === ts.SyntaxKind.StringKeyword
  );
};

const lowerUnionVariant = (
  ctx: LoweringContext,
  member: ts.TypeNode,
  typeParameters: Set<string>,
): RivetType | null => {
  const literal = readLiteralTypeNode(ctx, member);
  return literal === null
    ? lowerTypeNode(ctx, member, typeParameters)
    : { kind: "literal", value: literal };
};

const tryLowerTaggedUnionTypeNode = (
  ctx: LoweringContext,
  node: ts.UnionTypeNode,
  memberNodes: readonly ts.TypeNode[],
  typeParameters: Set<string>,
): RivetType | null => {
  const members = memberNodes.map((member) => getObjectProperties(ctx, member));
  if (!members.every(isPresent)) {
    return null;
  }

  const discriminator = resolveTaggedUnionDiscriminator(ctx, members);
  if (!discriminator) {
    return null;
  }

  const variants = [];
  const seenTags = new Set<string>();

  for (const properties of members) {
    const discriminatorProperty = properties.find((property) => property.name === discriminator);
    const tag = discriminatorProperty && readLiteralTypeNode(ctx, discriminatorProperty.typeNode);
    if (!discriminatorProperty || typeof tag !== "string") {
      return null;
    }

    if (seenTags.has(tag)) {
      ctx.diagnostics.push(
        createNodeDiagnostic(
          discriminatorProperty.typeNode,
          "UNSUPPORTED_UNION",
          `Union "${node.getText()}" repeats discriminator value "${tag}".`,
        ),
      );
      return null;
    }
    seenTags.add(tag);

    const type = lowerInlineObject(ctx, properties, typeParameters);
    if (!type) {
      return null;
    }

    variants.push({ tag, type });
  }

  return {
    kind: "taggedUnion",
    discriminator,
    variants,
  };
};

/** The one required string-literal property every member declares. */
const resolveTaggedUnionDiscriminator = (
  ctx: LoweringContext,
  members: readonly (readonly PropertyDescriptor[])[],
): string | null => {
  const candidateNames = (properties: readonly PropertyDescriptor[]): string[] =>
    properties
      .filter((property) => isTaggedUnionDiscriminatorCandidate(ctx, property))
      .map((property) => property.name);
  const [first, ...rest] = members;
  const candidates = (first ? candidateNames(first) : []).filter((name) =>
    rest.every((properties) => candidateNames(properties).includes(name)),
  );
  return candidates.length === 1 ? candidates[0] : null;
};

const isTaggedUnionDiscriminatorCandidate = (
  ctx: LoweringContext,
  property: PropertyDescriptor,
): boolean => {
  return !property.optional && typeof readLiteralTypeNode(ctx, property.typeNode) === "string";
};

/**
 * The literal of a literal type node only. Type lowering keeps an alias
 * reference such as `type Kind = "a"` as a ref (an enum-like alias), so it
 * must not resolve through aliases the way endpoint-spec reads do.
 */
const readLiteralTypeNode = (ctx: LoweringContext, node: ts.TypeNode): LiteralValue | null => {
  return ts.isLiteralTypeNode(node) ? readLiteral(ctx.checker, node) : null;
};

/** `"a" | "b"` or `1 | 2`: every member a literal type node of one kind. */
const readLiteralUnion = (
  ctx: LoweringContext,
  members: readonly ts.TypeNode[],
): { kind: "string"; values: string[] } | { kind: "int"; values: number[] } | null => {
  const values = members.map((member) => readLiteralTypeNode(ctx, member));
  const strings = values.filter((value) => typeof value === "string");
  const numbers = values.filter((value) => typeof value === "number");
  if (strings.length === values.length) {
    return { kind: "string", values: strings };
  }

  return numbers.length === values.length ? { kind: "int", values: numbers } : null;
};

const isStringLikeRecordKey = (ctx: LoweringContext, node: ts.TypeNode): boolean => {
  if (node.kind === ts.SyntaxKind.StringKeyword) {
    return true;
  }

  return readStringLiteral(ctx, node) !== null;
};
