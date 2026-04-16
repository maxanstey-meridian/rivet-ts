import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { BundleResult } from "../../domain/bundle-result.js";
import type { BuildLocalTarget } from "../../domain/build-local-config.js";
import { ExtractionDiagnostic } from "../../domain/diagnostic.js";
import type { HandlerGroup } from "../../domain/handler-group.js";
import { ImplementationBundler } from "../../application/ports/implementation-bundler.js";
import { resolveTypeScriptProject } from "../typescript/typescript-project.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(currentDir, "..", "..", "..");
const distIndexPath = path.resolve(packageRoot, "dist", "index.js");

export class EsbuildImplementationBundler extends ImplementationBundler {
  public async bundle(
    entryPath: string,
    handlerGroups: readonly HandlerGroup[],
    target: BuildLocalTarget,
    outDir: string,
    tsconfigPath?: string,
  ): Promise<BundleResult> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rivet-bundle-"));
    const project = resolveTypeScriptProject(entryPath, tsconfigPath);

    try {
      const handlersEntryPath = this.writeSyntheticHandlersEntry(
        tmpDir,
        project.absoluteEntryPath,
        handlerGroups,
      );
      const runtimeEntryPath = this.writeSyntheticRuntimeEntry(tmpDir);

      const plugins: Plugin[] = [
        this.createRivetRedirectPlugin(runtimeEntryPath),
      ];
      if (target === "browser") {
        plugins.push(this.createNodeBuiltinBlockerPlugin());
      }

      const result = await build({
        entryPoints: {
          handlers: handlersEntryPath,
          "rivet-runtime": runtimeEntryPath,
        },
        bundle: true,
        splitting: true,
        format: "esm",
        outdir: outDir,
        write: false,
        platform: target === "browser" ? "browser" : "node",
        plugins,
        logLevel: "silent",
        tsconfig: project.configFilePath ?? undefined,
      });

      const outputFiles = new Map<string, string>();
      for (const file of result.outputFiles) {
        const relativePath = path.relative(outDir, file.path);
        outputFiles.set(relativePath, file.text);
      }

      return new BundleResult({ outputFiles, diagnostics: [] });
    } catch (error: unknown) {
      return this.handleBuildFailure(error);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  private writeSyntheticHandlersEntry(
    tmpDir: string,
    entryPath: string,
    handlerGroups: readonly HandlerGroup[],
  ): string {
    const absoluteEntryPath = path.resolve(entryPath);
    const exportNames = handlerGroups.map((g) => g.exportName).join(", ");
    const content = [
      `export { ${exportNames} } from "${absoluteEntryPath}";`,
      `export * from "${absoluteEntryPath}";`,
      "",
    ].join("\n");

    const filePath = path.join(tmpDir, "handlers.ts");
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  private writeSyntheticRuntimeEntry(tmpDir: string): string {
    const runtimeTypesPath = path.resolve(currentDir, "../../domain/runtime-types.js");
    const handlerTypesPath = path.resolve(currentDir, "../../domain/handler-types.js");

    const content = [
      `export { createDirectClient, RivetError, defineHandlers } from "${runtimeTypesPath}";`,
      `export { handle } from "${handlerTypesPath}";`,
      "",
    ].join("\n");

    const filePath = path.join(tmpDir, "rivet-runtime.ts");
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  private createRivetRedirectPlugin(runtimeEntryPath: string): Plugin {
    return {
      name: "rivet-redirect",
      setup(pluginBuild) {
        // Redirect 'rivet-ts' package imports to the synthetic runtime entry
        pluginBuild.onResolve({ filter: /^rivet-ts$/ }, () => ({
          path: runtimeEntryPath,
        }));

        // Redirect relative imports that resolve to the rivet-ts barrel (dist/index.js)
        pluginBuild.onResolve({ filter: /index\.js$/ }, (args) => {
          if (args.kind === "entry-point") return;
          const resolved = path.resolve(args.resolveDir, args.path);
          if (resolved === distIndexPath) {
            return { path: runtimeEntryPath };
          }
        });
      },
    };
  }

  private createNodeBuiltinBlockerPlugin(): Plugin {
    return {
      name: "rivet-node-builtin-blocker",
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^node:/ }, (args) => ({
          errors: [
            {
              text: `Node.js builtin "${args.path}" is not available when targeting browser`,
            },
          ],
        }));
      },
    };
  }

  private handleBuildFailure(error: unknown): BundleResult {
    if (
      error !== null &&
      typeof error === "object" &&
      "errors" in error &&
      Array.isArray((error as Record<string, unknown>).errors)
    ) {
      const buildErrors = (
        error as {
          errors: Array<{
            text: string;
            location?: { file?: string; line?: number; column?: number } | null;
          }>;
        }
      ).errors;

      const diagnostics = buildErrors.map(
        (e) =>
          new ExtractionDiagnostic({
            severity: "error",
            code: "BUNDLE_ERROR",
            message: e.text,
            filePath: e.location?.file ?? undefined,
            line: e.location?.line ?? undefined,
            column: e.location?.column ?? undefined,
          }),
      );

      return new BundleResult({ outputFiles: new Map(), diagnostics });
    }

    throw error;
  }
}
