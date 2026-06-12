import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/interfaces/cli/run-cli.js";
import { emitGoldenConfigSources } from "../../src/infrastructure/scaffold/workspace-emitter.js";
import {
  PLUMB_EXECUTABLE,
  expectPlumbClean,
  getProjectRoot,
  linkScaffoldDependencies,
  plumbAvailable,
  typecheckScaffoldedWorkspace,
} from "../support/scaffold-oracles.js";

/**
 * The `scaffold` command is the engine behind `meridian init --ts-backend`:
 * a contract-less golden-shape workspace with one worked example module.
 * Gates, in order of strictness: shape → tsc → runtime behavior → plumb
 * (zero findings — the permanent generator/doctrine coupling).
 */
describe("scaffold lifecycle", () => {
  let outputDirectory: string;

  beforeAll(async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-scaffold-"));
    outputDirectory = path.join(tempDirectory, "demo-app");

    const stderr: string[] = [];
    const exitCode = await runCli(
      ["scaffold", "--out", outputDirectory, "--name", "demo"],
      {
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
  }, 120000);

  it("emits the golden workspace shape with the worked quotes example", async () => {
    const mustExist = [
      "Taskfile.yml",
      ".gitignore",
      ".editorconfig",
      ".oxlintrc.json",
      ".oxfmtrc.json",
      "README.md",
      "pnpm-workspace.yaml",
      path.join("apps", "api", "src", "contracts.ts"),
      path.join("apps", "api", "src", "app.ts"),
      path.join("apps", "api", "src", "composition.ts"),
      path.join("apps", "api", "src", "modules", "quotes", "quotes-routes.ts"),
      path.join("apps", "api", "src", "modules", "quotes", "quotes-validation.ts"),
      path.join("apps", "api", "src", "modules", "quotes", "quotes.module.ts"),
      path.join("apps", "api", "src", "modules", "quotes", "domain", "quote.ts"),
      path.join("apps", "api", "src", "modules", "quotes", "application", "ports", "quote-store.ts"),
      path.join("apps", "api", "src", "modules", "quotes", "application", "add-quote.ts"),
      path.join("apps", "api", "src", "modules", "quotes", "infrastructure", "in-memory-quote-store.ts"),
      path.join("apps", "api", "src", "modules", "quotes", "infrastructure", "dexie-quote-store.ts"),
      path.join("apps", "api", "src", "modules", "users", "application", "ports", "current-user.ts"),
      path.join("apps", "api", "src", "modules", "users", "users-routes.ts"),
      path.join("apps", "api", "src", "modules", "users", "users.module.ts"),
      path.join("apps", "api", "src", "validation.ts"),
      path.join("apps", "ui", "app", "assets", "css", "app.css"),
      path.join("apps", "api", "test", "add-quote.test.ts"),
      path.join("apps", "api", "test", "validation.test.ts"),
      path.join("apps", "api", "generated", "api.contract.json"),
      path.join("apps", "ui", "nuxt.config.ts"),
      path.join("apps", "ui", "eslint.config.mjs"),
      path.join("apps", "ui", "app", "app.vue"),
      path.join("apps", "ui", "app", "plugins", "rivet.client.ts"),
      path.join("packages", "contracts", "src", "index.ts"),
      path.join("packages", "contracts", "generated", "openapi.json"),
      path.join("packages", "contracts", "generated", "schema.d.ts"),
    ];

    for (const relativePath of mustExist) {
      await expect(
        fs.stat(path.join(outputDirectory, relativePath)),
        relativePath,
      ).resolves.toBeTruthy();
    }

    // §9.10: the HTTP edge is module-local — the old top-level src/interface/
    // tree must not come back.
    await expect(
      fs.stat(path.join(outputDirectory, "apps", "api", "src", "interface")),
    ).rejects.toThrow();

    // The bootstrap contract derives from lowering the EMITTED entry through
    // the real pipeline — never a hand-maintained copy that can drift.
    const contractJson = JSON.parse(
      await fs.readFile(
        path.join(outputDirectory, "apps", "api", "generated", "api.contract.json"),
        "utf8",
      ),
    ) as { endpoints: Array<{ name: string; routeTemplate: string }> };
    expect(contractJson.endpoints.map((endpoint) => endpoint.name).sort()).toEqual([
      "addQuote",
      "listQuotes",
      "me",
    ]);

    const nuxtConfigSource = await fs.readFile(
      path.join(outputDirectory, "apps", "ui", "nuxt.config.ts"),
      "utf8",
    );
    expect(nuxtConfigSource).toContain("ssr: false");
    expect(nuxtConfigSource).toContain('"@nuxt/eslint"');
    expect(nuxtConfigSource).toContain('"@nuxt/ui"');

    // The ui form consumes the SAME schema the api parses with.
    const appVueSource = await fs.readFile(
      path.join(outputDirectory, "apps", "ui", "app", "app.vue"),
      "utf8",
    );
    expect(appVueSource).toContain('":schema="addQuoteRequest"'.replace(/^"|"$/g, ""));
    expect(appVueSource).toContain("/api/validation");

    const apiPackageJsonSource = await fs.readFile(
      path.join(outputDirectory, "apps", "api", "package.json"),
      "utf8",
    );
    expect(apiPackageJsonSource).toContain('"./validation"');
    expect(apiPackageJsonSource).toContain('"zod"');
    expect(apiPackageJsonSource).toContain('"dexie"');
  });

  it("typechecks (api + contracts) against the current runtime", async () => {
    await typecheckScaffoldedWorkspace(outputDirectory);
  }, 120000);

  it("serves the contract: list, add, 422, declared 409, structured 500, /api/me", async () => {
    await linkScaffoldDependencies(outputDirectory);
    const apiSrc = path.join(outputDirectory, "apps", "api", "src");
    const { createApp } = (await import(path.join(apiSrc, "app.ts"))) as {
      createApp: (
        useCases: unknown,
      ) => { request: (input: string, init?: RequestInit) => Promise<Response> };
    };
    const { composeApp } = (await import(path.join(apiSrc, "composition.ts"))) as {
      composeApp: (adapters: { quoteStore: unknown }) => unknown;
    };
    const { InMemoryQuoteStore } = (await import(
      path.join(apiSrc, "modules", "quotes", "infrastructure", "in-memory-quote-store.ts")
    )) as { InMemoryQuoteStore: new () => unknown };

    // The server entry's wiring, minus serve(): the composition split means
    // the node-side test never touches the Dexie adapter (no IndexedDB here).
    const app = createApp(composeApp({ quoteStore: new InMemoryQuoteStore() }));

    const list = await app.request("/api/quotes");
    expect(list.status).toBe(200);
    const quotes = (await list.json()) as Array<{ text: string }>;
    expect(quotes[0]?.text).toBe("Never cross; always Common.");

    const add = (text: string) =>
      app.request("/api/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, author: "Max" }),
      });

    const created = await add("Ship it.");
    expect(created.status).toBe(201);

    // Edge validation: blank fields produce the 422 envelope BEFORE any
    // use case runs.
    const invalid = await add("   ");
    expect(invalid.status).toBe(422);
    const invalidBody = (await invalid.json()) as {
      code: string;
      errors: Record<string, string[]>;
    };
    expect(invalidBody.code).toBe("validation_failed");
    expect(invalidBody.errors.text).toBeTruthy();

    // The users module serves the stubbed identity.
    const me = await app.request("/api/me");
    expect(me.status).toBe(200);
    expect(((await me.json()) as { name: string }).name).toBe("Local Dev");

    // The declared failure travels as the contract's 409 result.
    const duplicate = await add("  ship it. ");
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { code: string }).code).toBe("duplicate_quote");

    // S5 regression: malformed input must produce a structured response in
    // local mode — never a rejected dispatch promise.
    const malformed = await app.request("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect([400, 500]).toContain(malformed.status);
  }, 60000);

  it("passes plumb with zero findings (generator/doctrine coupling)", async () => {
    if (!(await plumbAvailable())) {
      console.warn(`plumb not found at ${PLUMB_EXECUTABLE}; skipping the doctrine gate.`);
      return;
    }

    await expectPlumbClean(outputDirectory);
  }, 60000);

  it("keeps the embedded golden configs in sync with plumb's configs/ (D3)", async () => {
    if (!(await plumbAvailable())) {
      console.warn(`plumb not found at ${PLUMB_EXECUTABLE}; skipping the config sync gate.`);
      return;
    }

    const plumbConfigsRoot = path.join(path.dirname(PLUMB_EXECUTABLE), "configs");
    const embedded = emitGoldenConfigSources();

    // plumb's golden base is a SUPERSET floor: every key plumb requires must
    // be present with the required value in what we embed.
    const assertCovers = (golden: unknown, actual: unknown, context: string): void => {
      if (Array.isArray(golden)) {
        expect(actual, context).toEqual(golden);
        return;
      }
      if (golden && typeof golden === "object") {
        for (const [key, value] of Object.entries(golden)) {
          expect(actual, context).toHaveProperty(key);
          assertCovers(value, (actual as Record<string, unknown>)[key], `${context}.${key}`);
        }
        return;
      }
      expect(actual, context).toBe(golden);
    };

    const pairs: Array<[plumbFile: string, embeddedFile: string]> = [
      ["oxlintrc.json", ".oxlintrc.json"],
      ["oxfmtrc.json", ".oxfmtrc.json"],
    ];

    for (const [plumbFile, embeddedFile] of pairs) {
      const golden = JSON.parse(
        await fs.readFile(path.join(plumbConfigsRoot, plumbFile), "utf8"),
      ) as unknown;
      const ours = JSON.parse(embedded[embeddedFile] ?? "{}") as unknown;
      assertCovers(golden, ours, embeddedFile);
    }
  });

  it("refuses to overwrite a non-empty output directory unless --force is passed", async () => {
    const stderr: string[] = [];
    const exitCode = await runCli(["scaffold", "--out", outputDirectory, "--name", "demo"], {
      stdout: () => undefined,
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("--force");
  });
});

/**
 * `scaffold --no-api` — Nuxt ui + contracts only, for repos whose API lives
 * elsewhere (`meridian init --dotnet-backend` composes golden's .NET api on
 * top of exactly this variant).
 */
describe("scaffold --no-api lifecycle", () => {
  let outputDirectory: string;

  beforeAll(async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-scaffold-noapi-"));
    outputDirectory = path.join(tempDirectory, "fe-app");

    const stderr: string[] = [];
    const exitCode = await runCli(
      ["scaffold", "--out", outputDirectory, "--name", "fe-demo", "--no-api"],
      {
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
  }, 60000);

  it("emits ui + contracts and no api app", async () => {
    await expect(fs.stat(path.join(outputDirectory, "apps", "api"))).rejects.toThrow();
    await expect(
      fs.stat(path.join(outputDirectory, "apps", "ui", "nuxt.config.ts")),
    ).resolves.toBeTruthy();
    const generatedEntries = await fs.readdir(
      path.join(outputDirectory, "packages", "contracts", "generated"),
    );
    expect(generatedEntries.sort()).toEqual(["openapi.json", "schema.d.ts"]);

    const uiPackageJsonSource = await fs.readFile(
      path.join(outputDirectory, "apps", "ui", "package.json"),
      "utf8",
    );
    expect(uiPackageJsonSource).not.toContain("@fe-demo/api");
    expect(uiPackageJsonSource).toContain("@fe-demo/contracts");

    const pluginSource = await fs.readFile(
      path.join(outputDirectory, "apps", "ui", "app", "plugins", "rivet.client.ts"),
      "utf8",
    );
    expect(pluginSource).toContain("baseUrl");
    expect(pluginSource).not.toContain("app.request");

    const taskfileSource = await fs.readFile(path.join(outputDirectory, "Taskfile.yml"), "utf8");
    expect(taskfileSource).not.toContain("api:run");
    expect(taskfileSource).toContain("openapi-typescript ./generated/openapi.json");
    expect(taskfileSource).toContain("plumb");
  });

  it("typechecks the contracts package", async () => {
    await linkScaffoldDependencies(outputDirectory);
    const tscPath = path.join(getProjectRoot(), "node_modules", ".bin", "tsc");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)(tscPath, [
      "--noEmit",
      "-p",
      path.join(outputDirectory, "packages", "contracts", "tsconfig.json"),
    ]);
  }, 60000);

  it("passes plumb with zero findings", async () => {
    if (!(await plumbAvailable())) {
      console.warn(`plumb not found at ${PLUMB_EXECUTABLE}; skipping the doctrine gate.`);
      return;
    }

    await expectPlumbClean(outputDirectory);
  }, 60000);
});

