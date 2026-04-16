import fs from "node:fs/promises";
import path from "node:path";
import type { RivetContractDocument } from "../../domain/rivet-contract.js";
import {
  PackageEmitter,
  type PackageEmitterConfig,
} from "../../application/ports/package-emitter.js";
import {
  emitEnumDeclaration,
  emitTypeDefinition,
} from "../codegen/rivet-type-to-typescript.js";

export class LocalPackageEmitter extends PackageEmitter {
  public async emit(config: PackageEmitterConfig): Promise<void> {
    const { outDir, packageName, target, clientModules, bundleFiles, contractDocuments } = config;

    await fs.mkdir(outDir, { recursive: true });
    await fs.mkdir(path.join(outDir, "client"), { recursive: true });
    await fs.mkdir(path.join(outDir, "runtime"), { recursive: true });
    await fs.mkdir(path.join(outDir, "contract"), { recursive: true });
    await fs.mkdir(path.join(outDir, "types"), { recursive: true });

    await Promise.all([
      this.writePackageJson(outDir, packageName, target, clientModules, contractDocuments),
      this.writeIndexJs(outDir, clientModules),
      this.writeIndexDts(outDir, clientModules),
      this.writeClientModules(outDir, clientModules),
      this.writeTypesModule(outDir, contractDocuments),
      this.writeRuntimeFiles(outDir, bundleFiles),
      this.writeContractFiles(outDir, contractDocuments),
    ]);
  }

  private async writePackageJson(
    outDir: string,
    packageName: string,
    target: string,
    clientModules: readonly { readonly clientName: string }[],
    contractDocuments: Map<string, unknown>,
  ): Promise<void> {
    const exports: Record<string, { types: string; import: string } | string> = {
      ".": {
        types: "./index.d.ts",
        import: "./index.js",
      },
    };

    for (const mod of clientModules) {
      exports[`./client/${mod.clientName}`] = {
        types: `./client/${mod.clientName}.d.ts`,
        import: `./client/${mod.clientName}.js`,
      };
    }

    exports["./types"] = {
      types: "./types/index.d.ts",
      import: "./types/index.js",
    };

    for (const contractName of contractDocuments.keys()) {
      exports[`./contract/${contractName}`] = `./contract/${contractName}.contract.json`;
    }

    const packageJson = {
      name: packageName,
      version: "0.0.0",
      type: "module",
      exports,
      rivet: {
        kind: "local-package",
        target,
      },
    };

    await fs.writeFile(
      path.join(outDir, "package.json"),
      JSON.stringify(packageJson, null, 2) + "\n",
    );
  }

  private async writeIndexJs(
    outDir: string,
    clientModules: readonly { readonly clientName: string }[],
  ): Promise<void> {
    const lines = clientModules.map(
      (mod) => `export { ${mod.clientName} } from "./client/${mod.clientName}.js";`,
    );
    await fs.writeFile(path.join(outDir, "index.js"), lines.join("\n") + "\n");
  }

  private async writeIndexDts(
    outDir: string,
    clientModules: readonly { readonly clientName: string }[],
  ): Promise<void> {
    const lines = clientModules.map(
      (mod) => `export { ${mod.clientName} } from "./client/${mod.clientName}.js";`,
    );
    lines.push(`export type * from "./types/index.js";`);
    await fs.writeFile(path.join(outDir, "index.d.ts"), lines.join("\n") + "\n");
  }

  private async writeClientModules(
    outDir: string,
    clientModules: readonly {
      readonly clientName: string;
      readonly jsSource: string;
      readonly dtsSource: string;
    }[],
  ): Promise<void> {
    const writes = clientModules.flatMap((mod) => [
      fs.writeFile(path.join(outDir, "client", `${mod.clientName}.js`), mod.jsSource),
      fs.writeFile(path.join(outDir, "client", `${mod.clientName}.d.ts`), mod.dtsSource),
    ]);
    await Promise.all(writes);
  }

  private async writeRuntimeFiles(
    outDir: string,
    bundleFiles: Map<string, string>,
  ): Promise<void> {
    const writes: Promise<void>[] = [];
    for (const [relativePath, content] of bundleFiles) {
      const fullPath = path.join(outDir, "runtime", relativePath);
      const dir = path.dirname(fullPath);
      writes.push(
        fs.mkdir(dir, { recursive: true }).then(() => fs.writeFile(fullPath, content)),
      );
    }
    await Promise.all(writes);
  }

  private async writeTypesModule(
    outDir: string,
    contractDocuments: Map<string, RivetContractDocument>,
  ): Promise<void> {
    const enumSources = new Map<string, string>();
    const typeSources = new Map<string, string>();

    for (const document of contractDocuments.values()) {
      for (const rivetEnum of document.enums) {
        const source = emitEnumDeclaration(rivetEnum);
        const existingSource = enumSources.get(rivetEnum.name);

        if (existingSource !== undefined && existingSource !== source) {
          throw new Error(
            `Conflicting generated enum/type alias declarations for "${rivetEnum.name}" in local package output.`,
          );
        }

        enumSources.set(rivetEnum.name, source);
      }

      for (const typeDef of document.types) {
        const source = emitTypeDefinition(typeDef);
        const existingSource = typeSources.get(typeDef.name);

        if (existingSource !== undefined && existingSource !== source) {
          throw new Error(
            `Conflicting generated type declarations for "${typeDef.name}" in local package output.`,
          );
        }

        typeSources.set(typeDef.name, source);
      }
    }

    const dtsLines = [
      ...[...enumSources.keys()].sort().map((name) => enumSources.get(name)!),
      ...[...typeSources.keys()].sort().map((name) => typeSources.get(name)!),
      "",
    ];

    await Promise.all([
      fs.writeFile(path.join(outDir, "types", "index.js"), "export {};\n"),
      fs.writeFile(path.join(outDir, "types", "index.d.ts"), dtsLines.join("\n\n")),
    ]);
  }

  private async writeContractFiles(
    outDir: string,
    contractDocuments: Map<string, unknown>,
  ): Promise<void> {
    const writes: Promise<void>[] = [];
    for (const [contractName, document] of contractDocuments) {
      writes.push(
        fs.writeFile(
          path.join(outDir, "contract", `${contractName}.contract.json`),
          JSON.stringify(document, null, 2) + "\n",
        ),
      );
    }
    await Promise.all(writes);
  }
}
