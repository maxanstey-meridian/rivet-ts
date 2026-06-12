import fs from "node:fs/promises";
import path from "node:path";
import {
  emitClientFacadeSource,
  emitClientSchemaSource,
} from "../codegen/client-package-emitter.js";
import { toKebabCase } from "../codegen/kebab-case.js";

/**
 * Shared golden-shape workspace skeleton for both scaffold commands:
 *
 * ```
 * <out>/
 * ├── .editorconfig / .gitignore / .oxlintrc.json / .oxfmtrc.json
 * ├── Taskfile.yml / package.json / pnpm-workspace.yaml / README.md
 * ├── apps/
 * │   ├── api/   ← Hono backend (modules/<m>/{domain,application,infrastructure},
 * │   │            <m>-routes.ts + <m>-validation.ts + <m>.module.ts module-local
 * │   │            — suffix-free names, Meridian §9.1/§9.10)
 * │   └── ui/    ← Nuxt SPA (ssr: false), local-now transport via app.request
 * └── packages/contracts/
 *     ├── generated/{openapi.json, schema.d.ts}   ← read-only artifacts (RV-020)
 *     └── src/index.ts                            ← hand-owned client facade
 * ```
 *
 * Mirrors `~/Sites/golden` (the Meridian exemplar). The lint/format configs are
 * embedded copies of plumb's golden base configs (`~/.meridian/plumb/configs/`);
 * a freshly scaffolded repo passes `plumb .` with zero findings by construction.
 */

export type WorkspaceConfig = {
  readonly outDir: string;
  readonly projectName: string;
  /**
   * "full" = Hono api + Nuxt ui + contracts (the default);
   * "frontend-only" = Nuxt ui + contracts, for repos whose API lives
   * elsewhere (e.g. a .NET backend — `meridian init --dotnet-backend`
   * composes one on top of this variant).
   */
  readonly variant?: "full" | "frontend-only";
  /** e.g. `@myapp` */
  readonly packageScope: string;
  /** pinned `github:...#vX.Y.Z` dependency for the scaffolded project */
  readonly rivetTsDependency: string;
  /** versions lifted from rivet-ts's own manifest where possible */
  readonly versions: {
    readonly hono: string;
    readonly openApiFetch: string;
    readonly openApiTypescript: string;
    readonly typescript: string;
    readonly nodeTypes: string;
    readonly vitest: string;
  };
  /** entry path relative to `apps/api/src`, POSIX separators (e.g. `contracts.ts`) */
  readonly contractEntryRelativePath: string;
  /** contract interface names re-exported by `src/contract.ts` */
  readonly contractNames: readonly string[];
  /** bootstrap OpenAPI document written to packages/contracts/generated */
  readonly bootstrapOpenApiDocument: object;
  /** demo client call rendered in the UI, when one is callable without input */
  readonly demoCall?: { readonly httpMethod: string; readonly routeTemplate: string };
  /** extra runtime dependencies for the api package (e.g. typed-inject) */
  readonly extraApiDependencies?: Record<string, string>;
  /** full replacement for the generic app.vue (the example ships a UForm page) */
  readonly appVueSource?: string;
};

export const toPackageScope = (projectName: string): string =>
  `@${toKebabCase(projectName) || "rivet-app"}`;

const trimTsExtension = (value: string): string => value.replace(/\.ts$/u, "");

/* ─── embedded golden base configs (source: ~/.meridian/plumb/configs/) ────── */

const OXLINTRC_SOURCE = `${JSON.stringify(
  {
    categories: { correctness: "warn" },
    rules: { "no-unused-vars": "warn", curly: ["error", "all"] },
  },
  null,
  2,
)}\n`;

const OXFMTRC_SOURCE = `${JSON.stringify(
  {
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    semi: true,
    singleQuote: false,
    trailingComma: "all",
    sortImports: {
      enabled: true,
      groups: [
        ["builtin", "external"],
        ["internal", "subpath"],
        ["parent", "sibling", "index"],
      ],
      newlinesBetween: false,
      order: "asc",
      ignoreCase: true,
    },
  },
  null,
  2,
)}\n`;

const EDITORCONFIG_SOURCE = [
  "root = true",
  "",
  "[*]",
  "charset = utf-8",
  "end_of_line = lf",
  "insert_final_newline = true",
  "indent_style = space",
  "indent_size = 2",
  "trim_trailing_whitespace = true",
  "",
].join("\n");

const GITIGNORE_SOURCE = [
  "node_modules/",
  "dist/",
  ".nuxt/",
  ".output/",
  ".DS_Store",
  "",
].join("\n");

export const emitGoldenConfigSources = (): Record<string, string> => ({
  ".oxlintrc.json": OXLINTRC_SOURCE,
  ".oxfmtrc.json": OXFMTRC_SOURCE,
  ".editorconfig": EDITORCONFIG_SOURCE,
  ".gitignore": GITIGNORE_SOURCE,
});

/* ─── root files ───────────────────────────────────────────────────────────── */

const emitRootPackageJson = (config: WorkspaceConfig): string =>
  `${JSON.stringify(
    {
      name: toKebabCase(config.projectName) || "rivet-app",
      private: true,
      type: "module",
      packageManager: "pnpm@10.24.0",
      pnpm: {
        peerDependencyRules: {
          allowedVersions: {
            // openapi-typescript 7 declares typescript@^5 but runs fine on 6
            // (the scaffold's tsc + generate gates prove it); drop this rule
            // when openapi-typescript widens its peer range.
            "openapi-typescript>typescript": "6",
          },
        },
      },
    },
    null,
    2,
  )}\n`;

const emitPnpmWorkspace = (): string => ['packages:', '  - "apps/*"', '  - "packages/*"', ""].join("\n");

const emitTaskfile = (config: WorkspaceConfig): string => {
  const scope = config.packageScope;
  const entry = config.contractEntryRelativePath;

  if (config.variant === "frontend-only") {
    return [
      'version: "3"',
      "",
      "tasks:",
      "  install:",
      "    desc: Install workspace dependencies",
      "    cmds:",
      "      - pnpm install",
      "",
      "  dev:",
      "    desc: Run the Nuxt frontend",
      "    cmds:",
      `      - pnpm --filter ${scope}/ui dev`,
      "",
      "  generate:",
      "    desc: Regenerate schema.d.ts from openapi.json (replace the first command with your API's spec emitter)",
      "    cmds:",
      '      # TODO: produce packages/contracts/generated/openapi.json from your API,',
      '      # e.g. dotnet run --project <api.csproj path via Rivet.Tool> --output ./packages/contracts/generated',
      `      - pnpm --filter ${scope}/contracts exec openapi-typescript ./generated/openapi.json -o ./generated/schema.d.ts`,
      "",
      "  plumb:",
      "    desc: Check the repo against Meridian doctrine",
      "    cmds:",
      "      - ~/.meridian/plumb/plumb .",
      "",
    ].join("\n");
  }

  return [
    'version: "3"',
    "",
    "tasks:",
    "  install:",
    "    desc: Install workspace dependencies",
    "    cmds:",
    "      - pnpm install",
    "",
    "  dev:",
    "    desc: Run the Nuxt frontend (the API runs in-browser via the local transport)",
    "    cmds:",
    `      - pnpm --filter ${scope}/ui dev`,
    "",
    "  api:run:",
    "    desc: Run the API as a real server",
    "    cmds:",
    `      - pnpm --filter ${scope}/api start`,
    "",
    "  api:test:",
    "    desc: Typecheck and test the API",
    "    cmds:",
    `      - pnpm --filter ${scope}/api test`,
    "",
    "  generate:",
    "    desc: Regenerate the contracts package from the API contract entry",
    "    cmds:",
    `      - pnpm --filter ${scope}/api exec rivet-ts --entry src/${entry} --out generated/api.contract.json`,
    `      - pnpm --filter ${scope}/api exec rivet-ts rivet -- --from generated/api.contract.json --output ../../packages/contracts/generated`,
    `      - pnpm --filter ${scope}/api exec rivet-ts generate --generated-root ../../packages/contracts/generated`,
    "",
    "  test:",
    "    desc: Run every test suite",
    "    cmds:",
    "      - task: api:test",
    "",
    "  plumb:",
    "    desc: Check the repo against Meridian doctrine",
    "    cmds:",
    "      - ~/.meridian/plumb/plumb .",
    "",
  ].join("\n");
};

const emitReadme = (config: WorkspaceConfig): string => {
  if (config.variant === "frontend-only") {
    return [
      `# ${config.projectName}`,
      "",
      "Rivet-scaffolded frontend workspace. The API lives elsewhere;",
      "`packages/contracts/generated/` holds its OpenAPI artifacts (read-only —",
      "regenerate via `task generate` once its first command points at your API).",
      "",
      "| Command | What it does |",
      "|---|---|",
      "| `task install` | install workspace dependencies |",
      "| `task dev` | Nuxt frontend |",
      "| `task generate` | openapi.json → schema.d.ts |",
      "| `task plumb` | Meridian doctrine check |",
      "",
      "The typed client base URL is configured in",
      "`apps/ui/app/plugins/rivet.client.ts`.",
      "",
    ].join("\n");
  }

  return [
    `# ${config.projectName}`,
    "",
    "Rivet-scaffolded workspace. The API contract entry",
    `(\`apps/api/src/${config.contractEntryRelativePath}\`) is the source of truth;`,
    "`task generate` regenerates `packages/contracts/generated/` (read-only).",
    "",
    "| Command | What it does |",
    "|---|---|",
    "| `task install` | install workspace dependencies |",
    "| `task dev` | Nuxt frontend; the API runs in-browser via the local transport |",
    "| `task api:run` | promote the API to a real server |",
    "| `task generate` | contract entry → openapi.json → schema.d.ts |",
    "| `task api:test` | typecheck + tests |",
    "| `task plumb` | Meridian doctrine check |",
    "",
    "To point the UI at a real server instead of the in-browser API, edit",
    "`apps/ui/app/plugins/rivet.client.ts`.",
    "",
  ].join("\n");
};

/* ─── contracts package ────────────────────────────────────────────────────── */

const emitContractsPackageJson = (config: WorkspaceConfig): string =>
  `${JSON.stringify(
    {
      name: `${config.packageScope}/contracts`,
      private: true,
      type: "module",
      exports: { ".": "./src/index.ts" },
      dependencies: { "openapi-fetch": config.versions.openApiFetch },
      devDependencies: {
        "openapi-typescript": config.versions.openApiTypescript,
        typescript: config.versions.typescript,
      },
    },
    null,
    2,
  )}\n`;

const emitContractsTsconfig = (): string =>
  `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["src", "generated"],
    },
    null,
    2,
  )}\n`;

/* ─── api app shell ────────────────────────────────────────────────────────── */

const emitApiPackageJson = (config: WorkspaceConfig): string =>
  `${JSON.stringify(
    {
      name: `${config.packageScope}/api`,
      private: true,
      type: "module",
      imports: { "#contract": "./src/contract.ts" },
      exports: {
        "./local": "./src/local.ts",
        // The same schemas that guard the server's front door validate UForm
        // state in the ui — one source of rules, two enforcement points.
        "./validation": "./src/validation.ts",
      },
      scripts: {
        start: "tsx src/main.ts",
        test: "tsc --noEmit && vitest run --passWithNoTests",
      },
      dependencies: {
        hono: config.versions.hono,
        "rivet-ts": config.rivetTsDependency,
        zod: "^4.3.6",
        ...config.extraApiDependencies,
      },
      devDependencies: {
        "@hono/node-server": "^1.14.0",
        "@types/node": config.versions.nodeTypes,
        tsx: "^4.19.0",
        typescript: config.versions.typescript,
        vitest: config.versions.vitest,
      },
    },
    null,
    2,
  )}\n`;

const emitApiTsconfig = (): string =>
  `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        forceConsistentCasingInFileNames: true,
        types: ["node"],
      },
      include: ["src", "test"],
    },
    null,
    2,
  )}\n`;

const emitContractReExport = (config: WorkspaceConfig): string => {
  const exports = [...config.contractNames].sort().join(", ");
  const fromPath = `./${trimTsExtension(config.contractEntryRelativePath)}.js`;
  return `export type { ${exports} } from ${JSON.stringify(fromPath)};\n`;
};

const emitLocalSource = (): string => 'export { app } from "./app.js";\n';

const emitMainSource = (): string =>
  [
    'import { serve } from "@hono/node-server";',
    'import { app } from "./app.js";',
    "",
    "serve({ fetch: app.fetch, port: 5180 }, (info) => {",
    "  console.log(`api listening on http://localhost:${info.port}`);",
    "});",
    "",
  ].join("\n");

/* ─── ui app ───────────────────────────────────────────────────────────────── */

const emitUiPackageJson = (config: WorkspaceConfig): string =>
  `${JSON.stringify(
    {
      name: `${config.packageScope}/ui`,
      private: true,
      type: "module",
      scripts: {
        dev: "nuxt dev",
        build: "nuxt build",
        postinstall: "nuxt prepare",
      },
      dependencies: {
        ...(config.variant === "frontend-only"
          ? {}
          : { [`${config.packageScope}/api`]: "workspace:*" }),
        [`${config.packageScope}/contracts`]: "workspace:*",
        "@nuxt/ui": "^4.5.1",
        nuxt: "^4.3.1",
        vue: "^3.5.0",
      },
      devDependencies: {
        "@nuxt/eslint": "^1.0.0",
        eslint: "^9.0.0",
      },
    },
    null,
    2,
  )}\n`;

const emitNuxtConfig = (): string =>
  [
    "export default defineNuxtConfig({",
    "  ssr: false,",
    '  modules: ["@nuxt/eslint", "@nuxt/ui"],',
    '  css: ["~/assets/css/app.css"],',
    "  devtools: { enabled: true },",
    "  typescript: {",
    "    strict: true,",
    "  },",
    '  compatibilityDate: "2026-06-11",',
    "});",
    "",
  ].join("\n");

const emitUiEslintConfig = (): string =>
  [
    "// eslint is the Vue layer only — oxlint owns non-Vue linting (Meridian).",
    "// @nuxt/eslint writes ./.nuxt/eslint.config.mjs during nuxt prepare.",
    'import withNuxt from "./.nuxt/eslint.config.mjs";',
    "",
    "export default withNuxt();",
    "",
  ].join("\n");

const emitUiTsconfig = (): string =>
  `${JSON.stringify({ extends: "./.nuxt/tsconfig.json" }, null, 2)}\n`;

const emitRivetClientPlugin = (config: WorkspaceConfig): string => {
  if (config.variant === "frontend-only") {
    return [
      `import { configureRivet } from "${config.packageScope}/contracts";`,
      "",
      "// Point the typed client at the API serving the contract in",
      "// packages/contracts/generated/.",
      "export default defineNuxtPlugin(() => {",
      '  configureRivet({ baseUrl: "http://localhost:5000" });',
      "});",
      "",
    ].join("\n");
  }

  return [
    `import { app } from "${config.packageScope}/api/local";`,
    `import { configureRivet } from "${config.packageScope}/contracts";`,
    "",
    "// Local-now: the whole API runs in the browser, dispatched through",
    "// app.request. When you promote it to a real server (task api:run), swap",
    '// the fetch dispatch for { baseUrl: "http://localhost:5180" }.',
    "export default defineNuxtPlugin(() => {",
    "  configureRivet({ fetch: (request) => app.request(request) });",
    "});",
    "",
  ].join("\n");
};

const emitUiAppCss = (): string => ['@import "tailwindcss";', '@import "@nuxt/ui";', ""].join("\n");

const emitAppVue = (config: WorkspaceConfig): string => {
  if (config.appVueSource) {
    return config.appVueSource;
  }
  if (!config.demoCall) {
    return [
      '<script setup lang="ts">',
      `import { client } from "${config.packageScope}/contracts";`,
      "",
      "// The typed client is configured in app/plugins/rivet.client.ts.",
      "// Start consuming it here, e.g.:",
      '//   const { data } = await client.GET("/api/...");',
      "void client;",
      "</script>",
      "",
      "<template>",
      "  <main>",
      `    <h1>${config.projectName}</h1>`,
      "    <p>Typed client configured — open <code>app/app.vue</code> and start consuming it.</p>",
      "  </main>",
      "</template>",
      "",
    ].join("\n");
  }

  const method = config.demoCall.httpMethod.toUpperCase();
  const route = config.demoCall.routeTemplate;
  return [
    '<script setup lang="ts">',
    `import { client } from "${config.packageScope}/contracts";`,
    "",
    "// openapi-fetch never throws on HTTP errors — always handle { data, error }.",
    `const { data, error } = await client.${method}(${JSON.stringify(route)});`,
    "</script>",
    "",
    "<template>",
    "  <main>",
    `    <h1>${config.projectName}</h1>`,
    `    <p><code>client.${method}(${JSON.stringify(route)})</code></p>`,
    '    <pre v-if="error">{{ JSON.stringify(error, null, 2) }}</pre>',
    "    <pre v-else>{{ JSON.stringify(data, null, 2) }}</pre>",
    "  </main>",
    "</template>",
    "",
  ].join("\n");
};

/* ─── orchestration ────────────────────────────────────────────────────────── */

export type WorkspacePaths = {
  readonly apiRoot: string;
  readonly apiSourceRoot: string;
  readonly contractsGeneratedRoot: string;
};

/**
 * Emits every file of the skeleton EXCEPT the api's app code (app.ts, modules,
 * routes, composition) — those differ per command and are layered on by the
 * caller. Also writes the bootstrap generated artifacts (api.contract.json is
 * the caller's job; openapi.json + schema.d.ts happen here so a fresh scaffold
 * has a coherent typed-client chain before the first `task generate`).
 */
export const emitWorkspaceSkeleton = async (
  config: WorkspaceConfig,
  contractDocumentJson: string,
): Promise<WorkspacePaths> => {
  const out = config.outDir;
  const apiRoot = path.join(out, "apps", "api");
  const apiSourceRoot = path.join(apiRoot, "src");
  const uiRoot = path.join(out, "apps", "ui");
  const contractsRoot = path.join(out, "packages", "contracts");
  const contractsGeneratedRoot = path.join(contractsRoot, "generated");
  const withApi = config.variant !== "frontend-only";

  await Promise.all([
    ...(withApi
      ? [
          fs.mkdir(apiSourceRoot, { recursive: true }),
          fs.mkdir(path.join(apiRoot, "generated"), { recursive: true }),
        ]
      : []),
    fs.mkdir(path.join(uiRoot, "app", "plugins"), { recursive: true }),
    fs.mkdir(path.join(uiRoot, "app", "assets", "css"), { recursive: true }),
    fs.mkdir(contractsGeneratedRoot, { recursive: true }),
    fs.mkdir(path.join(contractsRoot, "src"), { recursive: true }),
  ]);

  const configFiles = emitGoldenConfigSources();

  await Promise.all([
    ...Object.entries(configFiles).map(([name, source]) =>
      fs.writeFile(path.join(out, name), source),
    ),
    fs.writeFile(path.join(out, "package.json"), emitRootPackageJson(config)),
    fs.writeFile(path.join(out, "pnpm-workspace.yaml"), emitPnpmWorkspace()),
    fs.writeFile(path.join(out, "Taskfile.yml"), emitTaskfile(config)),
    fs.writeFile(path.join(out, "README.md"), emitReadme(config)),
    fs.writeFile(path.join(contractsRoot, "package.json"), emitContractsPackageJson(config)),
    fs.writeFile(path.join(contractsRoot, "tsconfig.json"), emitContractsTsconfig()),
    fs.writeFile(path.join(contractsRoot, "src", "index.ts"), emitClientFacadeSource()),
    ...(withApi
      ? [
          fs.writeFile(path.join(apiRoot, "package.json"), emitApiPackageJson(config)),
          fs.writeFile(path.join(apiRoot, "tsconfig.json"), emitApiTsconfig()),
          fs.writeFile(path.join(apiSourceRoot, "contract.ts"), emitContractReExport(config)),
          fs.writeFile(path.join(apiSourceRoot, "local.ts"), emitLocalSource()),
          fs.writeFile(path.join(apiSourceRoot, "main.ts"), emitMainSource()),
          fs.writeFile(path.join(apiRoot, "generated", "api.contract.json"), contractDocumentJson),
        ]
      : []),
    fs.writeFile(path.join(uiRoot, "package.json"), emitUiPackageJson(config)),
    fs.writeFile(path.join(uiRoot, "nuxt.config.ts"), emitNuxtConfig()),
    fs.writeFile(path.join(uiRoot, "eslint.config.mjs"), emitUiEslintConfig()),
    fs.writeFile(path.join(uiRoot, "tsconfig.json"), emitUiTsconfig()),
    fs.writeFile(path.join(uiRoot, "app", "app.vue"), emitAppVue(config)),
    fs.writeFile(path.join(uiRoot, "app", "assets", "css", "app.css"), emitUiAppCss()),
    fs.writeFile(
      path.join(uiRoot, "app", "plugins", "rivet.client.ts"),
      emitRivetClientPlugin(config),
    ),
  ]);

  // Bootstrap artifacts: openapi.json (routes/statuses only) then schema.d.ts
  // derived from it locally, so the chain is coherent without the binary.
  const openApiPath = path.join(contractsGeneratedRoot, "openapi.json");
  await fs.writeFile(openApiPath, `${JSON.stringify(config.bootstrapOpenApiDocument, null, 2)}\n`);
  const schemaSource = await emitClientSchemaSource(openApiPath);
  await fs.writeFile(path.join(contractsGeneratedRoot, "schema.d.ts"), schemaSource);

  return { apiRoot, apiSourceRoot, contractsGeneratedRoot };
};

/**
 * S6 guard: refuse to scaffold into a directory that already has content,
 * unless the caller passed --force. Returns null when safe to proceed.
 */
export const checkOutDirSafety = async (
  outDir: string,
  force: boolean,
): Promise<string | null> => {
  let entries: string[];
  try {
    entries = await fs.readdir(outDir);
  } catch {
    return null; // does not exist yet
  }

  const meaningful = entries.filter((entry) => entry !== ".git" && entry !== ".DS_Store");
  if (meaningful.length === 0 || force) {
    return null;
  }

  return (
    `Output directory ${outDir} is not empty (${meaningful.length} entries). ` +
    "Scaffolding would overwrite files you may have edited. Pass --force to proceed."
  );
};
