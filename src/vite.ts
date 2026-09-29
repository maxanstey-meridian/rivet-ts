import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Plugin, ResolvedConfig } from "vite";
import {
  resolveRivetBinaryConfig,
  type ResolvedRivetBinaryConfig,
  type RivetBinaryConfig,
} from "./config/rivet-binary.js";
import { emitClientPackage } from "./infrastructure/codegen/client-package-emitter.js";
import { toKebabCase } from "./infrastructure/codegen/kebab-case.js";
import { lowerContracts } from "./infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { ensureRivetBinary } from "./infrastructure/vite/rivet-binary.js";
import { formatDiagnostic } from "./interfaces/diagnostics.js";

const execFileAsync = promisify(execFile);

export type RivetTsVitePluginOptions = {
  readonly entry: string;
  readonly apiRoot: string;
  readonly runtimeContractOut?: string;
  readonly clientOutDir?: string;
  readonly tsconfig?: string;
  readonly rivet?: RivetBinaryConfig & {
    /** How long one Rivet run may take before the build fails. Default 120000. */
    readonly timeoutMs?: number;
  };
};

type NormalizedPluginOptions = {
  readonly entryPath: string;
  readonly apiRoot: string;
  readonly tsconfigPath?: string;
  readonly runtimeContractPath: string;
  readonly clientOutDir: string;
  readonly openApiPath: string;
  readonly binaryConfig: ResolvedRivetBinaryConfig;
  readonly rivetTimeoutMs: number;
};

/**
 * Configured paths are resolved against the directory the Vite config file
 * lives in (falling back to the resolved root), never `process.cwd()` —
 * `vite -c myapp/vite.config.ts` from a parent directory must not resolve
 * entry/apiRoot/clientOutDir relative to the parent.
 */
const normalizeOptions = (
  options: RivetTsVitePluginOptions,
  baseDir: string,
): NormalizedPluginOptions => {
  const apiRoot = path.resolve(baseDir, options.apiRoot);
  const entryPath = path.resolve(baseDir, options.entry);
  const projectName = path.basename(apiRoot);
  const defaultContractJsonFileName = `${toKebabCase(projectName) || "contract"}.contract.json`;
  const runtimeContractPath = options.runtimeContractOut
    ? path.resolve(baseDir, options.runtimeContractOut)
    : path.join(apiRoot, "generated", defaultContractJsonFileName);
  const clientOutDir = options.clientOutDir
    ? path.resolve(baseDir, options.clientOutDir)
    : path.join(apiRoot, "generated");

  return {
    entryPath,
    apiRoot,
    tsconfigPath: options.tsconfig ? path.resolve(baseDir, options.tsconfig) : undefined,
    runtimeContractPath,
    clientOutDir,
    openApiPath: path.join(clientOutDir, "openapi.json"),
    binaryConfig: resolveRivetBinaryConfig(options.rivet),
    rivetTimeoutMs: options.rivet?.timeoutMs ?? 120_000,
  };
};

const generateArtifacts = async (
  options: NormalizedPluginOptions,
  config: ResolvedConfig,
): Promise<readonly string[]> => {
  const lowered = lowerContracts(options.entryPath, { tsconfigPath: options.tsconfigPath });
  if (lowered.diagnostics.length > 0) {
    const formatted = lowered.diagnostics.map(formatDiagnostic).join("\n");
    if (lowered.hasErrors) {
      config.logger.error(formatted);
      throw new Error("rivet-ts/vite failed to reflect the contract.");
    }
    config.logger.warn(formatted);
  }

  await fs.mkdir(path.dirname(options.runtimeContractPath), { recursive: true });
  await fs.writeFile(
    options.runtimeContractPath,
    `${JSON.stringify(lowered.document, null, 2)}\n`,
    "utf8",
  );

  // The binary is the sole OpenAPI emitter: contract JSON in, `--output <dir>`
  // writes <dir>/openapi.json. The TypeScript types are generated locally
  // from that spec.
  const executablePath = await ensureRivetBinary(options.binaryConfig);

  // Freshness guard: the spec on disk may be the scaffold-time bootstrap
  // placeholder (or a previous run's output), so it is moved aside before the
  // binary runs. A binary that exits 0 without writing openapi.json (wrong
  // path, missing emitter, partial failure) must hard-fail here instead of
  // silently feeding the stale spec back into `schema.d.ts` — silently wrong
  // types are the exact failure mode Rivet exists to prevent. On failure the
  // previous spec is restored and the generated client package is left
  // untouched, so last-good artifacts persist and recovery is instant.
  const previousSpec = await fs.readFile(options.openApiPath, "utf8").catch(() => undefined);
  if (previousSpec !== undefined) {
    await fs.rm(options.openApiPath, { force: true });
  }
  const restorePreviousSpec = async (): Promise<void> => {
    if (previousSpec !== undefined) {
      await fs.writeFile(options.openApiPath, previousSpec, "utf8");
    }
  };

  try {
    await execFileAsync(
      executablePath,
      ["--from", options.runtimeContractPath, "--output", options.clientOutDir],
      {
        cwd: options.apiRoot,
        maxBuffer: Infinity,
        signal: AbortSignal.timeout(options.rivetTimeoutMs),
      },
    );
  } catch (error) {
    await restorePreviousSpec();
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `rivet-ts/vite: the Rivet binary did not finish within ${options.rivetTimeoutMs}ms.`,
      );
    }
    throw error;
  }

  const specWasWritten = await fs.access(options.openApiPath).then(
    () => true,
    () => false,
  );
  if (!specWasWritten) {
    await restorePreviousSpec();
    const message =
      `[rivet-ts] The Rivet binary exited successfully but did not write an OpenAPI spec to ` +
      `${options.openApiPath}. The generated client package was NOT regenerated` +
      `${previousSpec !== undefined ? " (previous artifacts were left in place)" : ""}. ` +
      `Likely cause: the binary's --output handling changed, or "${executablePath}" is not the Rivet OpenAPI emitter.`;
    config.logger.error(message);
    throw new Error(`rivet-ts/vite: the Rivet binary did not write ${options.openApiPath}.`);
  }

  await emitClientPackage(options.clientOutDir);

  return lowered.sourceFiles.map((file) => file.absolutePath);
};

export const rivetTs = (options: RivetTsVitePluginOptions): Plugin => {
  const watchedFiles = new Set<string>();
  let normalized: NormalizedPluginOptions | undefined;
  let resolvedConfig: ResolvedConfig | undefined;
  let queue = Promise.resolve();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let debounced: Promise<void> | undefined;
  let resolveDebounced: (() => void) | undefined;

  // Editors commonly fire two change events per save; collapse a burst into
  // one regeneration.
  const regenerateDebounced = (reason: string): Promise<void> => {
    if (!debounced) {
      debounced = new Promise((resolve) => {
        resolveDebounced = resolve;
      });
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      const release = resolveDebounced;
      debounced = undefined;
      resolveDebounced = undefined;
      debounceTimer = undefined;
      void regenerate(reason).finally(() => release?.());
    }, 50);
    return debounced;
  };

  const regenerate = async (reason: string): Promise<void> => {
    const currentConfig = resolvedConfig;
    const currentOptions = normalized;
    if (!currentConfig || !currentOptions) {
      return;
    }

    queue = queue
      .catch(() => undefined)
      .then(async () => {
        currentConfig.logger.info(`[rivet-ts] Generating API artifacts (${reason})...`);
        const dependencies = await generateArtifacts(currentOptions, currentConfig);
        // Swap, never clear-then-refill: a change event landing mid-regen must
        // still match the previous watch set.
        const next = new Set(dependencies.map((dependency) => path.resolve(dependency)));
        // The entry stays watched even if a later regeneration narrows the
        // dependency set.
        next.add(currentOptions.entryPath);
        watchedFiles.clear();
        for (const file of next) {
          watchedFiles.add(file);
        }
      });

    return queue;
  };

  return {
    name: "rivet-ts",
    enforce: "pre",
    configResolved(config) {
      resolvedConfig = config;
      const baseDir = config.configFile ? path.dirname(config.configFile) : config.root;
      normalized = normalizeOptions(options, baseDir);
      // Watch the entry regardless of extraction success so a dev server
      // started against a broken contract can recover once the file is fixed.
      watchedFiles.add(normalized.entryPath);
    },
    async buildStart() {
      try {
        await regenerate("startup");
      } catch (error) {
        if (resolvedConfig?.command !== "serve") {
          throw error;
        }
        // Dev server: stay up and keep watching the entry; the failure has
        // already been logged as a diagnostic.
      }
      for (const filePath of watchedFiles) {
        this.addWatchFile(filePath);
      }
    },
    async handleHotUpdate(context) {
      const changedFile = path.resolve(context.file);
      if (!watchedFiles.has(changedFile)) {
        return;
      }

      await regenerateDebounced(path.relative(process.cwd(), changedFile));
      context.server.watcher.add([...watchedFiles]);
      context.server.ws.send({ type: "full-reload" });
      return [];
    },
  };
};
