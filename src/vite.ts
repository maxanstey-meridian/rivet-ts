import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Plugin, ResolvedConfig } from "vite";
import { TypeScriptContractFrontend } from "./infrastructure/typescript/typescript-contract-frontend.js";
import { TypeScriptRivetContractLowerer } from "./infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { emitLocalRivetSource } from "./infrastructure/codegen/local-rivet-emitter.js";
import { toKebabCase } from "./infrastructure/codegen/kebab-case.js";
import { collectLocalDependencies } from "./infrastructure/typescript/local-source-dependencies.js";
import { ensureRivetBinary, type RivetBinaryConfig } from "./infrastructure/vite/rivet-binary.js";

const execFileAsync = promisify(execFile);

const formatDiagnostics = (
  diagnostics: readonly {
    readonly severity: string;
    readonly code: string;
    readonly filePath?: string;
    readonly line?: number;
    readonly column?: number;
    readonly message: string;
  }[],
): string =>
  diagnostics
    .map((diagnostic) => {
      const location = diagnostic.filePath
        ? `${diagnostic.filePath}${diagnostic.line ? `:${diagnostic.line}:${diagnostic.column}` : ""}`
        : "(unknown)";

      return `${diagnostic.severity}: [${diagnostic.code}] ${location} ${diagnostic.message}`;
    })
    .join("\n");

const writeIfChanged = async (filePath: string, content: string): Promise<void> => {
  try {
    const current = await fs.readFile(filePath, "utf8");
    if (current === content) {
      return;
    }
  } catch {
    // noop
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
};

const resolveConfigPath = (value: string): string => path.resolve(process.cwd(), value);

export type RivetTsVitePluginOptions = {
  readonly contract: string;
  readonly apiRoot: string;
  readonly app: string;
  readonly tsconfig?: string;
  readonly rivet?: RivetBinaryConfig;
};

type NormalizedPluginOptions = {
  readonly contractPath: string;
  readonly apiRoot: string;
  readonly appPath: string;
  readonly tsconfigPath?: string;
  readonly contractJsonPath: string;
  readonly generatedRivetDir: string;
  readonly generatedRivetRuntimePath: string;
  readonly localRivetPath: string;
  readonly binaryConfig?: RivetBinaryConfig;
};

const normalizeOptions = (options: RivetTsVitePluginOptions): NormalizedPluginOptions => {
  const apiRoot = resolveConfigPath(options.apiRoot);
  const contractPath = resolveConfigPath(options.contract);
  const appPath = resolveConfigPath(options.app);
  const projectName = path.basename(apiRoot);
  const contractJsonFileName = `${toKebabCase(projectName) || "contract"}.contract.json`;

  return {
    contractPath,
    apiRoot,
    appPath,
    tsconfigPath: options.tsconfig ? resolveConfigPath(options.tsconfig) : undefined,
    contractJsonPath: path.join(apiRoot, "generated", contractJsonFileName),
    generatedRivetDir: path.join(apiRoot, "generated", "rivet"),
    generatedRivetRuntimePath: path.join(apiRoot, "generated", "rivet", "rivet.ts"),
    localRivetPath: path.join(apiRoot, "src", "local-rivet.ts"),
    binaryConfig: options.rivet,
  };
};

const generateArtifacts = async (
  options: NormalizedPluginOptions,
  config: ResolvedConfig,
): Promise<readonly string[]> => {
  const frontend = new TypeScriptContractFrontend(options.tsconfigPath);
  const lowerer = new TypeScriptRivetContractLowerer(options.tsconfigPath);
  const bundle = await frontend.extract(options.contractPath);
  const lowered = await lowerer.lower(bundle);
  const diagnostics = [...bundle.diagnostics, ...lowered.diagnostics];

  if (diagnostics.length > 0) {
    const formatted = formatDiagnostics(diagnostics);
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity === "error") {
        config.logger.error(formatted);
        break;
      }
    }

    if (lowered.hasErrors || bundle.hasErrors) {
      throw new Error("rivet-ts/vite failed to reflect the contract.");
    }

    config.logger.warn(formatted);
  }

  await fs.mkdir(path.dirname(options.contractJsonPath), { recursive: true });
  await fs.writeFile(options.contractJsonPath, `${JSON.stringify(lowered.document, null, 2)}\n`, "utf8");

  const binary = await ensureRivetBinary(options.binaryConfig);
  await execFileAsync(binary.executablePath, [
    "--from",
    options.contractJsonPath,
    "--output",
    options.generatedRivetDir,
  ], {
    cwd: options.apiRoot,
  });

  await writeIfChanged(
    options.localRivetPath,
    emitLocalRivetSource({
      filePath: options.localRivetPath,
      appFilePath: options.appPath,
      generatedRivetFilePath: options.generatedRivetRuntimePath,
    }),
  );

  const dependencies = await collectLocalDependencies(options.contractPath);
  return dependencies.map((dependency) => dependency.absolutePath);
};

export const rivetTs = (options: RivetTsVitePluginOptions): Plugin => {
  const normalized = normalizeOptions(options);
  const watchedFiles = new Set<string>();
  let resolvedConfig: ResolvedConfig | undefined;
  let queue = Promise.resolve();

  const regenerate = async (reason: string): Promise<void> => {
    const currentConfig = resolvedConfig;
    if (!currentConfig) {
      return;
    }

    queue = queue.catch(() => undefined).then(async () => {
      currentConfig.logger.info(`[rivet-ts] Generating API artifacts (${reason})...`);
      const dependencies = await generateArtifacts(normalized, currentConfig);
      watchedFiles.clear();
      for (const dependency of dependencies) {
        watchedFiles.add(path.resolve(dependency));
      }
    });

    return queue;
  };

  return {
    name: "rivet-ts",
    enforce: "pre",
    config: () => ({
      resolve: {
        alias: [
          {
            find: "@api",
            replacement: normalized.apiRoot,
          },
        ],
      },
    }),
    configResolved(config) {
      resolvedConfig = config;
    },
    async buildStart() {
      await regenerate("startup");
      for (const filePath of watchedFiles) {
        this.addWatchFile(filePath);
      }
    },
    async handleHotUpdate(context) {
      const changedFile = path.resolve(context.file);
      if (!watchedFiles.has(changedFile)) {
        return;
      }

      await regenerate(path.relative(process.cwd(), changedFile));
      context.server.watcher.add([...watchedFiles]);
      context.server.ws.send({ type: "full-reload" });
      return [];
    },
  };
};
