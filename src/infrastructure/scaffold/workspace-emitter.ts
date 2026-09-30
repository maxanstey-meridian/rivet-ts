import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RivetContractDocument } from "../../domain/rivet-contract.js";
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
 * │   │            <m>-routes.ts + <m>-validation.ts + <m>.module.ts module-local)
 * │   └── ui/    ← Nuxt SPA (ssr: false), local-now transport via app.request
 * └── packages/contracts/
 *     ├── generated/{openapi.json, schema.d.ts}   ← read-only artifacts
 *     └── src/index.ts                            ← hand-owned client facade
 * ```
 *
 * Mirrors `~/Sites/golden` (the Meridian exemplar). The lint/format configs are
 * embedded copies of plumb's golden base configs (plumb's `configs/`);
 * a freshly scaffolded repo passes `plumb .` with zero findings by construction.
 */

/** File contents keyed by POSIX path relative to a root directory. */
export type FileTree = Readonly<Record<string, string>>;

export const jsonFile = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export const writeTree = async (root: string, files: FileTree): Promise<void> => {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const target = path.join(root, relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
    }),
  );
};

type ManifestSection = "dependencies" | "devDependencies" | "peerDependencies";

type PackageManifest = { readonly version?: string } & {
  readonly [Section in ManifestSection]?: Readonly<Partial<Record<string, string>>>;
};

/** `templates/` ships beside `dist/` (package `files`); `../../../` is the package root from `src/` and `dist/`. */
export const templatePath = (...segments: readonly string[]): string =>
  path.join(fileURLToPath(new URL("../../../templates/", import.meta.url)), ...segments);

/**
 * A `templates/<name>` tree keyed relative to it, with every occurrence of
 * each token replaced. Tokens appear only inside string literals, so the
 * templates stay compilable (`tsc -p templates`).
 */
export const readTemplateTree = async (
  name: "example" | "shared",
  tokens: Readonly<Record<string, string>> = {},
): Promise<FileTree> => {
  const root = templatePath(name);
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const absolutePath = path.join(entry.parentPath, entry.name);
        const content = Object.entries(tokens).reduce(
          (text, [token, value]) => text.replaceAll(token, value),
          await fs.readFile(absolutePath, "utf8"),
        );
        return [path.relative(root, absolutePath).split(path.sep).join("/"), content] as const;
      }),
  );
  return Object.fromEntries(files);
};

/**
 * Where each scaffold dependency's version comes from in rivet-ts's own
 * manifest, so scaffolds pin what rivet-ts itself builds and tests against.
 */
const PINNED_PACKAGE_SECTIONS = {
  hono: "peerDependencies",
  "openapi-fetch": "dependencies",
  "openapi-typescript": "dependencies",
  typescript: "dependencies",
  "@types/node": "devDependencies",
  "@hono/node-server": "devDependencies",
  vitest: "devDependencies",
  zod: "devDependencies",
  dexie: "devDependencies",
  "typed-inject": "devDependencies",
  "vue-tsc": "devDependencies",
} as const satisfies Record<string, ManifestSection>;

export type PinnedPackage = keyof typeof PINNED_PACKAGE_SECTIONS;

/** rivet-ts's own `package.json`. */
export const readPackageManifest = async (): Promise<PackageManifest> => {
  const manifestText = await fs.readFile(new URL("../../../package.json", import.meta.url), "utf8");
  return JSON.parse(manifestText) as PackageManifest;
};

const pinnedVersions =
  (manifest: PackageManifest) =>
  (name: PinnedPackage): string => {
    const section = PINNED_PACKAGE_SECTIONS[name];
    const version = manifest[section]?.[name];
    if (version === undefined) {
      throw new Error(
        `rivet-ts package.json ${section} has no "${name}"; cannot pin the scaffold.`,
      );
    }
    return version;
  };

const toRivetTsDependency = (manifest: PackageManifest): string => {
  if (!manifest.version) {
    throw new Error("rivet-ts package.json is missing a version; cannot pin scaffold dependency.");
  }

  return `^${manifest.version}`;
};

export type WorkspaceConfig = {
  readonly outDir: string;
  readonly projectName: string;
} & (
  | {
      /** Nuxt ui + contracts, for repos whose API lives elsewhere (e.g. a .NET backend). */
      readonly variant: "frontend-only";
    }
  | {
      /** Hono api + Nuxt ui + contracts. */
      readonly variant: "full";
      readonly document: RivetContractDocument;
      /** entry path relative to `apps/api/src`, POSIX separators (e.g. `contracts.ts`) */
      readonly contractEntryRelativePath: string;
      /** demo client call rendered in the UI, when one is callable without input */
      readonly demoCall?: { readonly httpMethod: string; readonly routeTemplate: string };
      /** extra runtime dependencies for the api package */
      readonly extraApiDependencies?: readonly PinnedPackage[];
    }
);

type FullWorkspaceConfig = Extract<WorkspaceConfig, { readonly variant: "full" }>;

type Workspace<TConfig extends WorkspaceConfig = WorkspaceConfig> = TConfig & {
  readonly packageScope: string;
  readonly rivetTsDependency: string;
  readonly pin: (name: PinnedPackage) => string;
};

export const toPackageScope = (projectName: string): string =>
  `@${toKebabCase(projectName) || "rivet-app"}`;

/* ─── embedded golden base configs (source: plumb's configs/) ───────────────── */

const OXLINTRC_SOURCE = jsonFile({
  ignorePatterns: ["**/generated/**"],
  categories: { correctness: "warn" },
  rules: { "no-unused-vars": "warn", curly: ["error", "all"] },
});

const OXFMTRC_SOURCE = jsonFile({
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
});

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

const GITIGNORE_SOURCE = ["node_modules/", "dist/", ".nuxt/", ".output/", ".DS_Store", ""].join(
  "\n",
);

export const emitGoldenConfigSources = (): Record<string, string> => ({
  ".oxlintrc.json": OXLINTRC_SOURCE,
  ".oxfmtrc.json": OXFMTRC_SOURCE,
  ".editorconfig": EDITORCONFIG_SOURCE,
  ".gitignore": GITIGNORE_SOURCE,
});

/* ─── root files ───────────────────────────────────────────────────────────── */

const emitRootPackageJson = (workspace: Workspace): string =>
  jsonFile({
    name: toKebabCase(workspace.projectName) || "rivet-app",
    private: true,
    type: "module",
    packageManager: "pnpm@10.24.0",
  });

const emitPnpmWorkspace = (): string =>
  [
    "packages:",
    '  - "apps/*"',
    '  - "packages/*"',
    "",
    "# openapi-typescript 7 declares typescript@^5 but runs fine on 6 (the",
    "# scaffold's tsc + generate gates prove it); drop this rule when upstream",
    "# widens its peer range.",
    "peerDependencyRules:",
    "  allowedVersions:",
    '    "openapi-typescript>typescript": "6"',
    "",
  ].join("\n");

const PLUMB_TASK = [
  "  plumb:",
  "    desc: Check the repo against Meridian doctrine (plumb from $PLUMB, else on PATH)",
  "    cmds:",
  "      - ${PLUMB:-plumb} .",
  "",
];

/**
 * `--security <scheme>=bearer` for each scheme the contract's endpoints use:
 * Rivet refuses a secured endpoint whose scheme the command line does not
 * define (RIV2002), and a contract names its schemes but not their kind.
 */
export const bearerSecurityArguments = (document: RivetContractDocument): readonly string[] =>
  [...new Set(document.endpoints.flatMap(({ security }) => security?.scheme ?? []))].flatMap(
    (scheme) => ["--security", `${scheme}=bearer`],
  );

const emitTaskfile = (workspace: Workspace): string => {
  const scope = workspace.packageScope;

  if (workspace.variant === "frontend-only") {
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
      "      # TODO: produce packages/contracts/generated/openapi.json from your API,",
      "      # e.g. dotnet run --project <api.csproj path via Rivet.Tool> --output ./packages/contracts/generated",
      `      - pnpm --filter ${scope}/contracts exec openapi-typescript ./generated/openapi.json -o ./generated/schema.d.ts`,
      "",
      ...PLUMB_TASK,
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
    `      - pnpm --filter ${scope}/api exec rivet-ts --entry src/${workspace.contractEntryRelativePath} --out generated/api.contract.json`,
    `      - ${[
      `pnpm --filter ${scope}/api exec rivet-ts rivet --`,
      "--from generated/api.contract.json --output ../../packages/contracts/generated",
      ...bearerSecurityArguments(workspace.document),
    ].join(" ")}`,
    `      - pnpm --filter ${scope}/api exec rivet-ts generate --generated-root ../../packages/contracts/generated`,
    "",
    "  test:",
    "    desc: Run every test suite",
    "    cmds:",
    "      - task: api:test",
    "",
    ...PLUMB_TASK,
  ].join("\n");
};

const emitReadme = (workspace: Workspace): string => {
  if (workspace.variant === "frontend-only") {
    return [
      `# ${workspace.projectName}`,
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
    `# ${workspace.projectName}`,
    "",
    "Rivet-scaffolded workspace. The API contract entry",
    `(\`apps/api/src/${workspace.contractEntryRelativePath}\`) is the source of truth;`,
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

const emitContractsPackageJson = (workspace: Workspace): string =>
  jsonFile({
    name: `${workspace.packageScope}/contracts`,
    private: true,
    type: "module",
    exports: { ".": "./src/index.ts" },
    dependencies: { "openapi-fetch": workspace.pin("openapi-fetch") },
    devDependencies: {
      "openapi-typescript": workspace.pin("openapi-typescript"),
      typescript: workspace.pin("typescript"),
    },
  });

const CONTRACTS_TSCONFIG = jsonFile({
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  },
  include: ["src", "generated"],
});

/**
 * Bootstrap OpenAPI document: routes and statuses only, no schemas. It exists
 * so a fresh scaffold has a coherent generated client chain (openapi.json →
 * schema.d.ts) before the first real `task generate`, which overwrites both
 * with artifacts derived from the Rivet binary's full spec — the binary stays
 * the sole real OpenAPI emitter.
 */
const buildBootstrapOpenApiDocument = (workspace: Workspace): object => {
  const paths: Record<string, Record<string, object>> = {};

  for (const endpoint of workspace.variant === "full" ? workspace.document.endpoints : []) {
    const responses: Record<string, object> = {};

    for (const response of endpoint.responses) {
      responses[String(response.statusCode)] = response.dataType
        ? {
            description: response.description ?? "Success",
            content: { "application/json": {} },
          }
        : { description: response.description ?? "Success" };
    }

    if (Object.keys(responses).length === 0) {
      responses["200"] = { description: "Success" };
    }

    const route = (paths[endpoint.routeTemplate] ??= {});
    route[endpoint.httpMethod.toLowerCase()] = { responses };
  }

  return {
    openapi: "3.1.0",
    info: { title: workspace.projectName, version: "0.0.0" },
    paths,
  };
};

/* ─── api app shell ────────────────────────────────────────────────────────── */

const emitApiPackageJson = (workspace: Workspace<FullWorkspaceConfig>): string =>
  jsonFile({
    name: `${workspace.packageScope}/api`,
    private: true,
    type: "module",
    imports: { "#contract": `./src/${workspace.contractEntryRelativePath}` },
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
      hono: workspace.pin("hono"),
      "@maxanstey-meridian/rivet-ts": workspace.rivetTsDependency,
      zod: workspace.pin("zod"),
      ...Object.fromEntries(
        (workspace.extraApiDependencies ?? []).map((name) => [name, workspace.pin(name)]),
      ),
    },
    devDependencies: {
      "@hono/node-server": workspace.pin("@hono/node-server"),
      "@types/node": workspace.pin("@types/node"),
      tsx: "^4.19.0",
      typescript: workspace.pin("typescript"),
      vitest: workspace.pin("vitest"),
    },
  });

const API_TSCONFIG = jsonFile({
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
});

/* ─── ui app ───────────────────────────────────────────────────────────────── */

const emitUiPackageJson = (workspace: Workspace): string =>
  jsonFile({
    name: `${workspace.packageScope}/ui`,
    private: true,
    type: "module",
    scripts: {
      dev: "nuxt dev",
      build: "nuxt build",
      typecheck: "nuxt typecheck",
      postinstall: "nuxt prepare",
    },
    dependencies: {
      ...(workspace.variant === "frontend-only"
        ? {}
        : { [`${workspace.packageScope}/api`]: "workspace:*" }),
      [`${workspace.packageScope}/contracts`]: "workspace:*",
      "@nuxt/ui": "^4.5.1",
      nuxt: "^4.3.1",
      vue: "^3.5.0",
    },
    devDependencies: {
      "@nuxt/eslint": "^1.0.0",
      eslint: "^9.0.0",
      "vue-tsc": workspace.pin("vue-tsc"),
    },
  });

const NUXT_CONFIG_SOURCE = [
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

const UI_ESLINT_CONFIG_SOURCE = [
  "// eslint is the Vue layer only — oxlint owns non-Vue linting (Meridian).",
  "// @nuxt/eslint writes ./.nuxt/eslint.config.mjs during nuxt prepare.",
  'import withNuxt from "./.nuxt/eslint.config.mjs";',
  "",
  "export default withNuxt();",
  "",
].join("\n");

const UI_TSCONFIG = jsonFile({ extends: "./.nuxt/tsconfig.json" });

const emitRivetClientPlugin = (workspace: Workspace): string => {
  if (workspace.variant === "frontend-only") {
    return [
      `import { configureRivet } from "${workspace.packageScope}/contracts";`,
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
    `import { app } from "${workspace.packageScope}/api/local";`,
    `import { configureRivet } from "${workspace.packageScope}/contracts";`,
    "",
    "// Local-now: the whole API runs in the browser, dispatched through",
    "// app.request. When you promote it to a real server (task api:run), swap",
    '// the fetch dispatch for { baseUrl: "http://localhost:5180" }.',
    "export default defineNuxtPlugin(() => {",
    "  configureRivet({ fetch: async (request) => app.request(request) });",
    "});",
    "",
  ].join("\n");
};

const UI_APP_CSS_SOURCE = ['@import "tailwindcss";', '@import "@nuxt/ui";', ""].join("\n");

const emitAppVue = (workspace: Workspace): string => {
  const demoCall = workspace.variant === "full" ? workspace.demoCall : undefined;
  if (!demoCall) {
    return [
      '<script setup lang="ts">',
      `import { client } from "${workspace.packageScope}/contracts";`,
      "",
      "// The typed client is configured in app/plugins/rivet.client.ts.",
      "// Start consuming it here, e.g.:",
      '//   const { data } = await client.GET("/api/...");',
      "void client;",
      "</script>",
      "",
      "<template>",
      "  <main>",
      `    <h1>${workspace.projectName}</h1>`,
      "    <p>Typed client configured — open <code>app/app.vue</code> and start consuming it.</p>",
      "  </main>",
      "</template>",
      "",
    ].join("\n");
  }

  const method = demoCall.httpMethod.toUpperCase();
  const route = demoCall.routeTemplate;
  return [
    '<script setup lang="ts">',
    `import { client } from "${workspace.packageScope}/contracts";`,
    "",
    "// openapi-fetch never throws on HTTP errors — always handle { data, error }.",
    `const { data, error } = await client.${method}(${JSON.stringify(route)});`,
    "</script>",
    "",
    "<template>",
    "  <main>",
    `    <h1>${workspace.projectName}</h1>`,
    `    <p><code>client.${method}(${JSON.stringify(route)})</code></p>`,
    '    <pre v-if="error">{{ JSON.stringify(error, null, 2) }}</pre>',
    "    <pre v-else>{{ JSON.stringify(data, null, 2) }}</pre>",
    "  </main>",
    "</template>",
    "",
  ].join("\n");
};

/* ─── orchestration ────────────────────────────────────────────────────────── */

const skeletonFiles = (workspace: Workspace): FileTree => ({
  ...emitGoldenConfigSources(),
  "package.json": emitRootPackageJson(workspace),
  "pnpm-workspace.yaml": emitPnpmWorkspace(),
  "Taskfile.yml": emitTaskfile(workspace),
  "README.md": emitReadme(workspace),
  "packages/contracts/package.json": emitContractsPackageJson(workspace),
  "packages/contracts/tsconfig.json": CONTRACTS_TSCONFIG,
  "packages/contracts/src/index.ts": emitClientFacadeSource(),
  "packages/contracts/generated/openapi.json": jsonFile(buildBootstrapOpenApiDocument(workspace)),
  ...(workspace.variant === "full"
    ? {
        "apps/api/package.json": emitApiPackageJson(workspace),
        "apps/api/tsconfig.json": API_TSCONFIG,
        "apps/api/generated/api.contract.json": jsonFile(workspace.document),
      }
    : {}),
  "apps/ui/package.json": emitUiPackageJson(workspace),
  "apps/ui/nuxt.config.ts": NUXT_CONFIG_SOURCE,
  "apps/ui/eslint.config.mjs": UI_ESLINT_CONFIG_SOURCE,
  "apps/ui/tsconfig.json": UI_TSCONFIG,
  "apps/ui/app/app.vue": emitAppVue(workspace),
  "apps/ui/app/assets/css/app.css": UI_APP_CSS_SOURCE,
  "apps/ui/app/plugins/rivet.client.ts": emitRivetClientPlugin(workspace),
});

/**
 * Writes the workspace skeleton plus the caller's `files` (keyed relative to
 * `outDir`; they win over skeleton files at the same path), then derives the
 * bootstrap `schema.d.ts` from the bootstrap `openapi.json`, so a fresh
 * scaffold has a coherent typed-client chain before the first `task generate`.
 */
export const emitWorkspace = async (config: WorkspaceConfig, files: FileTree): Promise<void> => {
  const manifest = await readPackageManifest();
  const workspace: Workspace = {
    ...config,
    packageScope: toPackageScope(config.projectName),
    rivetTsDependency: toRivetTsDependency(manifest),
    pin: pinnedVersions(manifest),
  };

  await writeTree(config.outDir, { ...skeletonFiles(workspace), ...files });

  const generatedRoot = path.join(config.outDir, "packages", "contracts", "generated");
  await fs.writeFile(
    path.join(generatedRoot, "schema.d.ts"),
    await emitClientSchemaSource(path.join(generatedRoot, "openapi.json")),
  );
};

/**
 * Refuses to scaffold into a directory that already has content unless the
 * caller passed --force: scaffolding overwrites files the user may have edited.
 */
export const assertOutDirWritable = async (outDir: string, force: boolean): Promise<void> => {
  let entries: string[];
  try {
    entries = await fs.readdir(outDir);
  } catch {
    return; // does not exist yet
  }

  const meaningful = entries.filter((entry) => entry !== ".git" && entry !== ".DS_Store");
  if (meaningful.length === 0 || force) {
    return;
  }

  throw new Error(
    `Output directory ${outDir} is not empty (${meaningful.length} entries). ` +
      "Scaffolding would overwrite files you may have edited. Pass --force to proceed.",
  );
};
