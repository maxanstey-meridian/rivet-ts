// Reading the authoring DSL through the checker: rivet-ts and library symbols,
// literals, spec property maps and list entries. Shared by every lowering step.
import ts from "typescript";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";

/** What every lowering step reads from and reports to. */
export type LoweringContext = {
  readonly checker: ts.TypeChecker;
  readonly declarations: ReadonlyMap<string, SupportedDeclaration>;
  readonly diagnostics: ExtractionDiagnostic[];
};

export type SupportedDeclaration =
  | ts.EnumDeclaration
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration;

export type PropertyDescriptor = {
  name: string;
  typeNode: ts.TypeNode;
  optional: boolean;
  readOnly: boolean;
};

const AUTHORING_HELPER_TYPE_NAMES = new Set([
  "EndpointAuthoringSpec",
  "EndpointErrorAuthoringSpec",
  "EndpointSecurityAuthoringSpec",
]);

export const isListTypeName = (name: string | null): boolean =>
  name === "Array" || name === "ReadonlyArray";

export const isPresent = <T>(value: T | null): value is T => value !== null;

export const getPropertyName = (name: ts.PropertyName): string | null => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return null;
};

export const isNullTypeNode = (node: ts.TypeNode): boolean =>
  ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword;

export const hasModifier = (node: ts.Declaration, flag: ts.ModifierFlags): boolean =>
  (ts.getCombinedModifierFlags(node) & flag) !== 0;

export const resolveAlias = (checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol =>
  (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;

export const resolveSymbol = (checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined => {
  const symbol = checker.getSymbolAtLocation(node);
  return symbol && resolveAlias(checker, symbol);
};

// The authoring types ship as src/domain/authoring-types.ts (this repo's own
// contracts and tests import it) and as dist/domain/authoring-types.d.ts
// (the published package, re-exported by dist/index.d.ts).
const isRivetAuthoringFile = (sourceFile: ts.SourceFile): boolean =>
  /\/(?:src\/domain\/authoring-types\.ts|dist\/domain\/authoring-types\.d\.ts)$/u.test(
    sourceFile.fileName,
  );

/** Whether `node` names the rivet-ts authoring type `name`, through any import alias. */
export const isRivetSymbol = (checker: ts.TypeChecker, node: ts.Node, name: string): boolean => {
  const symbol = resolveSymbol(checker, node);
  return (
    symbol?.getName() === name &&
    (symbol.getDeclarations() ?? []).some((declaration) =>
      isRivetAuthoringFile(declaration.getSourceFile()),
    )
  );
};

export type LiteralValue = string | number | boolean;

export const literalValueOfType = (checker: ts.TypeChecker, type: ts.Type): LiteralValue | null => {
  if (type.isStringLiteral() || type.isNumberLiteral()) {
    return type.value;
  }

  if ((type.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
    return type === checker.getTrueType();
  }

  return null;
};

/** The literal a type node denotes, resolved through aliases (`type Get = "GET"`, `-1`). */
export const readLiteral = (
  checker: ts.TypeChecker,
  node: ts.TypeNode | undefined,
): LiteralValue | null =>
  node ? literalValueOfType(checker, checker.getTypeFromTypeNode(node)) : null;

export const createNodeDiagnostic = (
  node: ts.Node,
  code: string,
  message: string,
): ExtractionDiagnostic => {
  const sourceFile = node.getSourceFile();
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

  return new ExtractionDiagnostic({
    severity: "error",
    code,
    message,
    filePath: sourceFile.fileName,
    line: position.line + 1,
    column: position.character + 1,
  });
};

export const readStringLiteral = (
  ctx: LoweringContext,
  node: ts.TypeNode | undefined,
): string | null => {
  const value = readLiteral(ctx.checker, node);
  return typeof value === "string" ? value : null;
};

export const readNumericLiteral = (
  ctx: LoweringContext,
  node: ts.TypeNode | undefined,
): number | null => {
  const value = readLiteral(ctx.checker, node);
  return typeof value === "number" ? value : null;
};

export const readBooleanLiteral = (
  ctx: LoweringContext,
  node: ts.TypeNode | undefined,
): boolean | null => {
  const value = readLiteral(ctx.checker, node);
  return typeof value === "boolean" ? value : null;
};

export const resolveTypeName = (ctx: LoweringContext, node: ts.EntityName): string => {
  return resolveSymbol(ctx.checker, node)?.getName() ?? node.getText();
};

/**
 * The name of the library type `node` refers to (declared in a lib or
 * `@types` declaration file), or null when the contract source declares it.
 * `@types/node` alone declares `Blob`/`File` for node-only projects.
 */
export const libraryTypeName = (ctx: LoweringContext, node: ts.EntityName): string | null => {
  const symbol = resolveSymbol(ctx.checker, node);
  const isLibrary = (symbol?.getDeclarations() ?? []).some(
    (declaration) => declaration.getSourceFile().isDeclarationFile,
  );
  return symbol && isLibrary ? symbol.getName() : null;
};

/** Elements of an authored list: `T[]`, `[A, B]`, `Array<T>`/`ReadonlyArray<T>`, or an alias of one. */
export const getListEntryNodes = (
  ctx: LoweringContext,
  node: ts.TypeNode,
): ts.TypeNode[] | null => {
  if (ts.isParenthesizedTypeNode(node)) {
    return getListEntryNodes(ctx, node.type);
  }

  if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return getListEntryNodes(ctx, node.type);
  }

  if (ts.isTupleTypeNode(node)) {
    return [...node.elements];
  }

  if (ts.isArrayTypeNode(node)) {
    return [node.elementType];
  }

  if (ts.isTypeReferenceNode(node) && isListTypeName(libraryTypeName(ctx, node.typeName))) {
    const [elementType] = node.typeArguments ?? [];
    return elementType ? [elementType] : null;
  }

  const resolvedNode = resolveAliasedTypeNode(ctx, node);
  return resolvedNode ? getListEntryNodes(ctx, resolvedNode) : null;
};

const resolveAliasedTypeNode = (ctx: LoweringContext, node: ts.TypeNode): ts.TypeNode | null => {
  if (ts.isParenthesizedTypeNode(node)) {
    return resolveAliasedTypeNode(ctx, node.type);
  }

  if (!ts.isTypeReferenceNode(node)) {
    return null;
  }

  const symbol = ctx.checker.getSymbolAtLocation(node.typeName);
  const declarations = symbol?.getDeclarations() ?? [];
  for (const declaration of declarations) {
    if (ts.isTypeAliasDeclaration(declaration)) {
      return declaration.type;
    }
  }

  return null;
};

export const createPropertyMap = (
  ctx: LoweringContext,
  typeNode: ts.TypeNode,
): Map<string, ts.TypeNode> | null => {
  if (ts.isTypeLiteralNode(typeNode)) {
    return createPropertyMapFromTypeLiteral(typeNode);
  }

  const specType = ctx.checker.getTypeFromTypeNode(typeNode);
  if ((specType.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) === 0) {
    return null;
  }

  const sourceFile = typeNode.getSourceFile();
  const propertyMap = new Map<string, ts.TypeNode>();
  for (const propertySymbol of ctx.checker.getApparentType(specType).getProperties()) {
    const propertyTypeNode = selectPropertyTypeNode(ctx, propertySymbol, sourceFile);
    if (!propertyTypeNode) {
      continue;
    }

    propertyMap.set(propertySymbol.getName(), propertyTypeNode);
  }

  return propertyMap;
};

const createPropertyMapFromTypeLiteral = (
  typeLiteral: ts.TypeLiteralNode,
): Map<string, ts.TypeNode> => {
  const propertyMap = new Map<string, ts.TypeNode>();
  for (const member of typeLiteral.members) {
    if (!ts.isPropertySignature(member) || !member.type || !member.name) {
      continue;
    }

    const propertyName = getPropertyName(member.name);
    if (!propertyName) {
      continue;
    }

    propertyMap.set(propertyName, member.type);
  }

  return propertyMap;
};

const selectPropertyTypeNode = (
  ctx: LoweringContext,
  symbol: ts.Symbol,
  sourceFile: ts.SourceFile,
): ts.TypeNode | null => {
  const declarations = symbol
    .getDeclarations()
    ?.filter((declaration) => !isAuthoringHelperPropertyDeclaration(declaration))
    .flatMap((declaration) => {
      const typeNode = getPropertyTypeNode(declaration);
      return typeNode ? [{ declaration, typeNode }] : [];
    });

  if (!declarations || declarations.length === 0) {
    return null;
  }

  const inSourceFile = declarations.find(
    ({ declaration }) => declaration.getSourceFile().fileName === sourceFile.fileName,
  );

  return inSourceFile?.typeNode ?? declarations[0].typeNode;
};

const getPropertyTypeNode = (declaration: ts.Declaration): ts.TypeNode | null => {
  if (
    (ts.isPropertySignature(declaration) || ts.isPropertyDeclaration(declaration)) &&
    declaration.type
  ) {
    return declaration.type;
  }

  return null;
};

const isAuthoringHelperPropertyDeclaration = (declaration: ts.Declaration): boolean => {
  if (!ts.isPropertySignature(declaration) || !ts.isTypeLiteralNode(declaration.parent)) {
    return false;
  }

  const parent = declaration.parent.parent;
  return (
    ts.isTypeAliasDeclaration(parent) &&
    AUTHORING_HELPER_TYPE_NAMES.has(parent.name.text) &&
    isRivetAuthoringFile(parent.getSourceFile())
  );
};
