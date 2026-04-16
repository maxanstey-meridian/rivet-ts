import fs from "node:fs/promises";
import path from "node:path";
import {
  PackageEmitter,
  type PackageEmitterConfig,
} from "../../application/ports/package-emitter.js";

export class LocalPackageEmitter extends PackageEmitter {
  public async emit(config: PackageEmitterConfig): Promise<void> {
    const { outDir, packageName, target, clientModules, bundleFiles, contractDocuments } = config;

    await fs.mkdir(outDir, { recursive: true });
    await fs.mkdir(path.join(outDir, "client"), { recursive: true });
    await fs.mkdir(path.join(outDir, "runtime"), { recursive: true });
    await fs.mkdir(path.join(outDir, "contract"), { recursive: true });

    await Promise.all([
      this.writePackageJson(outDir, packageName, target, clientModules, contractDocuments),
      this.writeIndexJs(outDir, clientModules),
      this.writeIndexDts(outDir, clientModules),
      this.writeClientModules(outDir, clientModules),
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
