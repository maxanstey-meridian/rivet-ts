import path from "node:path";
import ts from "typescript";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import {
  RivetContractLoweringResult,
  type ContractSourceFile,
} from "../../domain/rivet-contract-lowering-result.js";
import {
  RivetContractDocument,
  RivetTypeDefinition,
  type RivetContractEnum,
  type RivetEndpointDefinition,
} from "../../domain/rivet-contract.js";
import type { LoweringContext } from "./authoring-syntax.js";
import {
  discoverContracts,
  indexDeclarations,
  toDiscoveredContract,
} from "./contract-discovery.js";
import { lowerEndpoint } from "./endpoint-lowering.js";
import {
  collectTypeReferences,
  getDefinitionReferences,
  lowerNamedDeclaration,
} from "./type-lowering.js";
import { mapTypeScriptDiagnostics, resolveTypeScriptProject } from "./typescript-project.js";

const EMPTY_DOCUMENT = new RivetContractDocument({});

/**
 * One pass from a TypeScript entry file to the Rivet contract document: one
 * tsconfig parse, one ts.Program and one checker shared by contract discovery
 * and lowering.
 */
export const lowerContracts = (
  entryPath: string,
  options: { readonly tsconfigPath?: string } = {},
): RivetContractLoweringResult => {
  const project = resolveTypeScriptProject(entryPath, options.tsconfigPath);
  const absoluteEntryPath = project.absoluteEntryPath;
  const program = ts.createProgram([absoluteEntryPath], project.compilerOptions);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(absoluteEntryPath);
  const diagnostics = [
    ...mapTypeScriptDiagnostics(project.configDiagnostics, absoluteEntryPath),
    ...mapTypeScriptDiagnostics(ts.getPreEmitDiagnostics(program), absoluteEntryPath),
  ];

  if (!sourceFile) {
    diagnostics.push(
      new ExtractionDiagnostic({
        severity: "error",
        code: "ENTRY_NOT_FOUND",
        message: `Could not load entry file: ${absoluteEntryPath}`,
        filePath: absoluteEntryPath,
      }),
    );

    return new RivetContractLoweringResult({
      document: EMPTY_DOCUMENT,
      diagnostics,
    });
  }

  const declarations = indexDeclarations(program, checker, diagnostics);
  const typeDefinitions = new Map<string, RivetTypeDefinition>();
  const enums = new Map<string, RivetContractEnum>();
  const endpoints: RivetEndpointDefinition[] = [];
  const referencedTypeNames = new Set<string>();
  const ctx: LoweringContext = { checker, declarations, diagnostics };
  const contracts = discoverContracts(ctx, sourceFile);

  for (const contract of contracts) {
    for (const endpoint of contract.endpoints) {
      const loweredEndpoint = lowerEndpoint(ctx, endpoint);
      endpoints.push(loweredEndpoint);
      for (const parameter of loweredEndpoint.params) {
        collectTypeReferences(parameter.type, referencedTypeNames);
      }
      if (loweredEndpoint.returnType) {
        collectTypeReferences(loweredEndpoint.returnType, referencedTypeNames);
      }
      for (const response of loweredEndpoint.responses) {
        if (response.dataType) {
          collectTypeReferences(response.dataType, referencedTypeNames);
        }
      }
    }
  }

  const queue = [...referencedTypeNames].sort();
  const queued = new Set(queue);
  while (queue.length > 0) {
    const name = queue.shift();
    if (!name || typeDefinitions.has(name) || enums.has(name)) {
      continue;
    }

    const lowered = lowerNamedDeclaration(ctx, name);
    if (!lowered) {
      continue;
    }

    if (!(lowered instanceof RivetTypeDefinition)) {
      enums.set(name, lowered);
      continue;
    }

    typeDefinitions.set(name, lowered);
    for (const reference of getDefinitionReferences(lowered)) {
      if (typeDefinitions.has(reference) || enums.has(reference) || queued.has(reference)) {
        continue;
      }

      queue.push(reference);
      queued.add(reference);
    }
  }

  const document = new RivetContractDocument({
    types: [...typeDefinitions.values()].sort((left, right) => left.name.localeCompare(right.name)),
    enums: [...enums.values()].sort((left, right) => left.name.localeCompare(right.name)),
    endpoints,
  });

  return new RivetContractLoweringResult({
    document,
    diagnostics,
    contracts: contracts.map(toDiscoveredContract),
    sourceFiles: toContractSourceFiles(
      program
        .getSourceFiles()
        .filter((file) => !file.isDeclarationFile && !program.isSourceFileFromExternalLibrary(file))
        .map((file) => path.resolve(file.fileName))
        .filter((filePath) => isProjectFile(project.projectDirectory, filePath)),
    ),
  });
};

const isWithin = (directory: string, candidate: string): boolean => {
  const relative = path.relative(directory, candidate);
  return !(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
};

/**
 * A tsconfig's `paths` can map a package to its source outside the project
 * (as `templates/tsconfig.json` maps rivet-ts to `src/`); those files are the
 * library's, not the contract's. Without a tsconfig there are no `paths`, so
 * every compiled source file was reached by the contract's own relative imports.
 */
const isProjectFile = (projectDirectory: string | undefined, filePath: string): boolean =>
  projectDirectory === undefined || isWithin(projectDirectory, filePath);

const toContractSourceFiles = (filePaths: readonly string[]): ContractSourceFile[] => {
  let root = filePaths.length > 0 ? path.dirname(filePaths[0]) : "";
  for (const filePath of filePaths) {
    while (!isWithin(root, filePath) && path.dirname(root) !== root) {
      root = path.dirname(root);
    }
  }

  return [...filePaths].sort().map((absolutePath) => ({
    absolutePath,
    relativePath: path.relative(root, absolutePath).split(path.sep).join("/"),
  }));
};
