import fs from "node:fs/promises";
import path from "node:path";
import {
  buildBootstrapOpenApiDocument,
  readPackageManifest,
  resolveWorkspaceVersions,
  toRivetTsDependency,
} from "./mock-project-emitter.js";
import {
  checkOutDirSafety,
  emitWorkspaceSkeleton,
  toPackageScope,
  type WorkspaceConfig,
} from "./workspace-emitter.js";
import type { RivetContractDocument } from "../../domain/rivet-contract.js";

/**
 * Contract-less scaffold (`rivet-ts scaffold`): the golden-shape workspace with
 * one worked example module — `quotes`, mirroring `~/Sites/golden`'s api-ts
 * idiom: typed-inject class use cases, abstract-class ports (private
 * constructor), in-memory adapters, domain errors mapped at the transport
 * edge, suffix-free file names throughout (Meridian §9.1).
 *
 * This is the command `meridian init --ts-backend` calls.
 */

const CONTRACTS_SOURCE = [
  'import type { Contract, Endpoint } from "rivet-ts";',
  "",
  "export type QuoteDto = {",
  "  id: string;",
  "  text: string;",
  "  author: string;",
  "  addedAt: string;",
  "};",
  "",
  "export type AddQuoteRequest = {",
  "  text: string;",
  "  author: string;",
  "};",
  "",
  "export type ApiError = {",
  "  code: string;",
  "  message: string;",
  "};",
  "",
  'export interface QuotesContract extends Contract<"Quotes"> {',
  "  ListQuotes: Endpoint<{",
  '    method: "GET";',
  '    route: "/api/quotes";',
  "    response: QuoteDto[];",
  '    summary: "List all quotes";',
  "  }>;",
  "",
  "  AddQuote: Endpoint<{",
  '    method: "POST";',
  '    route: "/api/quotes";',
  "    input: AddQuoteRequest;",
  "    response: QuoteDto;",
  "    successStatus: 201;",
  '    errors: [{ status: 409; response: ApiError; description: "Duplicate quote text" }];',
  '    summary: "Add a quote";',
  "  }>;",
  "}",
  "",
].join("\n");

const DOMAIN_QUOTE_SOURCE = [
  "export type Quote = {",
  "  id: string;",
  "  text: string;",
  "  author: string;",
  "  addedAt: string;",
  "};",
  "",
  "export const quoteTextsMatch = (left: string, right: string): boolean =>",
  "  left.trim().toLowerCase() === right.trim().toLowerCase();",
  "",
].join("\n");

const DOMAIN_ERROR_SOURCE = [
  "export class DuplicateQuoteError extends Error {",
  '  public readonly code = "duplicate_quote";',
  "",
  "  public constructor(text: string) {",
  "    super(`A quote with the text ${JSON.stringify(text)} already exists.`);",
  '    this.name = "DuplicateQuoteError";',
  "  }",
  "}",
  "",
].join("\n");

const PORT_QUOTE_STORE_SOURCE = [
  'import type { Quote } from "../../domain/quote.js";',
  "",
  "export abstract class QuoteStore {",
  "  private constructor() {}",
  "",
  "  abstract list(): Promise<Quote[]>;",
  "",
  "  abstract add(quote: Quote): Promise<void>;",
  "}",
  "",
].join("\n");

const PORT_CLOCK_SOURCE = [
  "export abstract class Clock {",
  "  private constructor() {}",
  "",
  "  abstract now(): Date;",
  "}",
  "",
].join("\n");

const USE_CASE_ADD_QUOTE_SOURCE = [
  'import { DuplicateQuoteError } from "../domain/duplicate-quote-error.js";',
  'import { quoteTextsMatch, type Quote } from "../domain/quote.js";',
  'import { Clock } from "./ports/clock.js";',
  'import { QuoteStore } from "./ports/quote-store.js";',
  "",
  "export type AddQuoteInput = {",
  "  text: string;",
  "  author: string;",
  "};",
  "",
  "export class AddQuote {",
  '  public static inject = ["quoteStore", "clock"] as const;',
  "",
  "  public constructor(",
  "    private readonly quoteStore: QuoteStore,",
  "    private readonly clock: Clock,",
  "  ) {}",
  "",
  "  public async execute(input: AddQuoteInput): Promise<Quote> {",
  "    const existing = await this.quoteStore.list();",
  "",
  "    if (existing.some((quote) => quoteTextsMatch(quote.text, input.text))) {",
  "      throw new DuplicateQuoteError(input.text);",
  "    }",
  "",
  "    const quote: Quote = {",
  "      id: crypto.randomUUID(),",
  "      text: input.text.trim(),",
  "      author: input.author.trim(),",
  "      addedAt: this.clock.now().toISOString(),",
  "    };",
  "",
  "    await this.quoteStore.add(quote);",
  "",
  "    return quote;",
  "  }",
  "}",
  "",
].join("\n");

const USE_CASE_LIST_QUOTES_SOURCE = [
  'import type { Quote } from "../domain/quote.js";',
  'import { QuoteStore } from "./ports/quote-store.js";',
  "",
  "export class ListQuotes {",
  '  public static inject = ["quoteStore"] as const;',
  "",
  "  public constructor(private readonly quoteStore: QuoteStore) {}",
  "",
  "  public execute(): Promise<Quote[]> {",
  "    return this.quoteStore.list();",
  "  }",
  "}",
  "",
].join("\n");

const INFRA_STORE_SOURCE = [
  'import { QuoteStore } from "../application/ports/quote-store.js";',
  'import type { Quote } from "../domain/quote.js";',
  "",
  "export class InMemoryQuoteStore implements QuoteStore {",
  "  private readonly quotes: Quote[] = [",
  "    {",
  '      id: "8b1c5d9e-0000-4000-8000-000000000001",',
  '      text: "Never cross; always Common.",',
  '      author: "Meridian doctrine",',
  '      addedAt: "2026-06-10T00:00:00.000Z",',
  "    },",
  "  ];",
  "",
  "  public list(): Promise<Quote[]> {",
  "    return Promise.resolve([...this.quotes]);",
  "  }",
  "",
  "  public add(quote: Quote): Promise<void> {",
  "    this.quotes.push(quote);",
  "    return Promise.resolve();",
  "  }",
  "}",
  "",
].join("\n");

const INFRA_CLOCK_SOURCE = [
  'import { Clock } from "../application/ports/clock.js";',
  "",
  "export class SystemClock implements Clock {",
  "  public now(): Date {",
  "    return new Date();",
  "  }",
  "}",
  "",
].join("\n");

const ROUTES_SOURCE = [
  'import type { Hono } from "hono";',
  'import { type ContractJson, registerRivetHonoRoutes, rivetHttpError } from "rivet-ts/hono";',
  'import type { QuotesContract } from "#contract";',
  'import type { AddQuote } from "../../modules/quotes/application/add-quote.js";',
  'import type { ListQuotes } from "../../modules/quotes/application/list-quotes.js";',
  'import { DuplicateQuoteError } from "../../modules/quotes/domain/duplicate-quote-error.js";',
  "",
  "export type QuotesUseCases = {",
  "  addQuote: AddQuote;",
  "  listQuotes: ListQuotes;",
  "};",
  "",
  "export const registerQuotesRoutes = (",
  "  app: Hono,",
  "  contract: ContractJson,",
  "  useCases: QuotesUseCases,",
  "): void => {",
  "  registerRivetHonoRoutes<QuotesContract>(app, contract, {",
  '    group: "quotes",',
  "    handlers: {",
  "      ListQuotes: () => useCases.listQuotes.execute(),",
  "      AddQuote: async ({ body }) => {",
  "        try {",
  "          return await useCases.addQuote.execute(body);",
  "        } catch (error) {",
  "          // Declared failures travel as contract results, not raw exceptions.",
  "          if (error instanceof DuplicateQuoteError) {",
  "            throw rivetHttpError(409, { code: error.code, message: error.message });",
  "          }",
  "          throw error;",
  "        }",
  "      },",
  "    },",
  "  });",
  "};",
  "",
].join("\n");

const COMPOSITION_SOURCE = [
  'import { createInjector } from "typed-inject";',
  'import type { QuotesUseCases } from "./interface/http/quotes-routes.js";',
  'import { AddQuote } from "./modules/quotes/application/add-quote.js";',
  'import { ListQuotes } from "./modules/quotes/application/list-quotes.js";',
  'import { InMemoryQuoteStore } from "./modules/quotes/infrastructure/in-memory-quote-store.js";',
  'import { SystemClock } from "./modules/quotes/infrastructure/system-clock.js";',
  "",
  "export const composeQuotes = (): QuotesUseCases => {",
  "  const injector = createInjector()",
  '    .provideValue("clock", new SystemClock())',
  '    .provideValue("quoteStore", new InMemoryQuoteStore());',
  "",
  "  return {",
  "    addQuote: injector.injectClass(AddQuote),",
  "    listQuotes: injector.injectClass(ListQuotes),",
  "  };",
  "};",
  "",
].join("\n");

const APP_SOURCE = [
  'import { Hono } from "hono";',
  'import contract from "../generated/api.contract.json" with { type: "json" };',
  'import { composeQuotes } from "./composition.js";',
  'import { registerQuotesRoutes } from "./interface/http/quotes-routes.js";',
  "",
  "export const app = new Hono();",
  "",
  "registerQuotesRoutes(app, contract, composeQuotes());",
  "",
  "// Unhandled handler errors become a structured 500 in BOTH the local",
  "// (in-browser) transport and a real server — same envelope, same status,",
  '// keeping the "local now, server later" behavioral parity promise.',
  "app.onError((error, context) => {",
  "  console.error(error);",
  '  return context.json({ code: "internal_error", message: "Unexpected error." }, 500);',
  "});",
  "",
].join("\n");

const TEST_SUPPORT_FAKE_STORE_SOURCE = [
  'import type { QuoteStore } from "../../src/modules/quotes/application/ports/quote-store.js";',
  'import type { Quote } from "../../src/modules/quotes/domain/quote.js";',
  "",
  "// Fake the PORT, never the database (Meridian testing doctrine).",
  "export class FakeQuoteStore implements QuoteStore {",
  "  public constructor(private readonly quotes: Quote[] = []) {}",
  "",
  "  public list(): Promise<Quote[]> {",
  "    return Promise.resolve([...this.quotes]);",
  "  }",
  "",
  "  public add(quote: Quote): Promise<void> {",
  "    this.quotes.push(quote);",
  "    return Promise.resolve();",
  "  }",
  "}",
  "",
].join("\n");

const TEST_SUPPORT_FIXED_CLOCK_SOURCE = [
  'import type { Clock } from "../../src/modules/quotes/application/ports/clock.js";',
  "",
  "export class FixedClock implements Clock {",
  '  public constructor(private readonly fixedAt = new Date("2026-01-01T00:00:00.000Z")) {}',
  "",
  "  public now(): Date {",
  "    return this.fixedAt;",
  "  }",
  "}",
  "",
].join("\n");

const TEST_ADD_QUOTE_SOURCE = [
  'import { describe, expect, it } from "vitest";',
  'import { AddQuote } from "../src/modules/quotes/application/add-quote.js";',
  'import { DuplicateQuoteError } from "../src/modules/quotes/domain/duplicate-quote-error.js";',
  'import { FakeQuoteStore } from "./support/fake-quote-store.js";',
  'import { FixedClock } from "./support/fixed-clock.js";',
  "",
  'describe("AddQuote", () => {',
  '  it("stores a trimmed quote stamped by the clock", async () => {',
  "    const store = new FakeQuoteStore();",
  "    const useCase = new AddQuote(store, new FixedClock());",
  "",
  '    const quote = await useCase.execute({ text: "  Ship it.  ", author: " Max " });',
  "",
  '    expect(quote.text).toBe("Ship it.");',
  '    expect(quote.author).toBe("Max");',
  '    expect(quote.addedAt).toBe("2026-01-01T00:00:00.000Z");',
  "    await expect(store.list()).resolves.toHaveLength(1);",
  "  });",
  "",
  '  it("rejects duplicate text regardless of casing and padding", async () => {',
  "    const store = new FakeQuoteStore([",
  "      {",
  '        id: "00000000-0000-4000-8000-000000000001",',
  '        text: "Ship it.",',
  '        author: "Max",',
  '        addedAt: "2026-01-01T00:00:00.000Z",',
  "      },",
  "    ]);",
  "    const useCase = new AddQuote(store, new FixedClock());",
  "",
  '    await expect(useCase.execute({ text: " ship it. ", author: "Someone" })).rejects.toThrow(',
  "      DuplicateQuoteError,",
  "    );",
  "  });",
  "});",
  "",
].join("\n");

export type ExampleProjectConfig = {
  readonly outDir: string;
  readonly projectName: string;
  readonly force: boolean;
  readonly document: RivetContractDocument;
};

/**
 * Emits the workspace skeleton plus the worked quotes example. The caller
 * (the scaffold use case) lowers the EMITTED contracts.ts and provides the
 * document — the same pipeline real projects run, so the bootstrap artifacts
 * can never drift from what the entry actually declares.
 */
export const emitExampleProject = async (config: ExampleProjectConfig): Promise<void> => {
  const safetyError = await checkOutDirSafety(config.outDir, config.force);
  if (safetyError) {
    throw new Error(safetyError);
  }

  const manifest = await readPackageManifest();

  const workspaceConfig: WorkspaceConfig = {
    outDir: config.outDir,
    projectName: config.projectName,
    packageScope: toPackageScope(config.projectName),
    rivetTsDependency: toRivetTsDependency(manifest),
    versions: resolveWorkspaceVersions(manifest),
    contractEntryRelativePath: "contracts.ts",
    contractNames: ["QuotesContract"],
    bootstrapOpenApiDocument: buildBootstrapOpenApiDocument(config),
    demoCall: { httpMethod: "GET", routeTemplate: "/api/quotes" },
    extraApiDependencies: { "typed-inject": "^5.0.0" },
  };

  const { apiRoot, apiSourceRoot } = await emitWorkspaceSkeleton(
    workspaceConfig,
    `${JSON.stringify(config.document, null, 2)}\n`,
  );

  const moduleRoot = path.join(apiSourceRoot, "modules", "quotes");
  await Promise.all([
    fs.mkdir(path.join(moduleRoot, "domain"), { recursive: true }),
    fs.mkdir(path.join(moduleRoot, "application", "ports"), { recursive: true }),
    fs.mkdir(path.join(moduleRoot, "infrastructure"), { recursive: true }),
    fs.mkdir(path.join(apiSourceRoot, "interface", "http"), { recursive: true }),
    fs.mkdir(path.join(apiRoot, "test", "support"), { recursive: true }),
  ]);

  await Promise.all([
    fs.writeFile(path.join(apiSourceRoot, "contracts.ts"), CONTRACTS_SOURCE),
    fs.writeFile(path.join(apiSourceRoot, "app.ts"), APP_SOURCE),
    fs.writeFile(path.join(apiSourceRoot, "composition.ts"), COMPOSITION_SOURCE),
    fs.writeFile(path.join(apiSourceRoot, "interface", "http", "quotes-routes.ts"), ROUTES_SOURCE),
    fs.writeFile(path.join(moduleRoot, "domain", "quote.ts"), DOMAIN_QUOTE_SOURCE),
    fs.writeFile(path.join(moduleRoot, "domain", "duplicate-quote-error.ts"), DOMAIN_ERROR_SOURCE),
    fs.writeFile(
      path.join(moduleRoot, "application", "ports", "quote-store.ts"),
      PORT_QUOTE_STORE_SOURCE,
    ),
    fs.writeFile(path.join(moduleRoot, "application", "ports", "clock.ts"), PORT_CLOCK_SOURCE),
    fs.writeFile(path.join(moduleRoot, "application", "add-quote.ts"), USE_CASE_ADD_QUOTE_SOURCE),
    fs.writeFile(
      path.join(moduleRoot, "application", "list-quotes.ts"),
      USE_CASE_LIST_QUOTES_SOURCE,
    ),
    fs.writeFile(
      path.join(moduleRoot, "infrastructure", "in-memory-quote-store.ts"),
      INFRA_STORE_SOURCE,
    ),
    fs.writeFile(path.join(moduleRoot, "infrastructure", "system-clock.ts"), INFRA_CLOCK_SOURCE),
    fs.writeFile(
      path.join(apiRoot, "test", "support", "fake-quote-store.ts"),
      TEST_SUPPORT_FAKE_STORE_SOURCE,
    ),
    fs.writeFile(
      path.join(apiRoot, "test", "support", "fixed-clock.ts"),
      TEST_SUPPORT_FIXED_CLOCK_SOURCE,
    ),
    fs.writeFile(path.join(apiRoot, "test", "add-quote.test.ts"), TEST_ADD_QUOTE_SOURCE),
  ]);
};

/** The example contract entry, exposed so the scaffold use case can lower it. */
export const EXAMPLE_CONTRACTS_SOURCE = CONTRACTS_SOURCE;

export type FrontendProjectConfig = {
  readonly outDir: string;
  readonly projectName: string;
  readonly force: boolean;
};

/**
 * Frontend-only scaffold (`rivet-ts scaffold --no-api`): Nuxt ui + contracts
 * package, no api app — for repos whose API lives elsewhere (a .NET backend,
 * a separate repo). The bootstrap spec is an empty-but-valid document; `task
 * generate`'s first command is a TODO pointing at the real API's emitter.
 */
export const emitFrontendOnlyProject = async (config: FrontendProjectConfig): Promise<void> => {
  const safetyError = await checkOutDirSafety(config.outDir, config.force);
  if (safetyError) {
    throw new Error(safetyError);
  }

  const manifest = await readPackageManifest();

  const workspaceConfig: WorkspaceConfig = {
    outDir: config.outDir,
    projectName: config.projectName,
    variant: "frontend-only",
    packageScope: toPackageScope(config.projectName),
    rivetTsDependency: toRivetTsDependency(manifest),
    versions: resolveWorkspaceVersions(manifest),
    contractEntryRelativePath: "",
    contractNames: [],
    bootstrapOpenApiDocument: {
      openapi: "3.1.0",
      info: { title: config.projectName, version: "0.0.0" },
      paths: {},
    },
  };

  await emitWorkspaceSkeleton(workspaceConfig, "");
};
