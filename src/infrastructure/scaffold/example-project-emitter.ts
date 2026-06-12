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
 * Contract-less scaffold (`rivet-ts scaffold`): the golden-shape workspace
 * with two worked example modules mirroring `~/Sites/golden`'s idiom plus the
 * proper-scaffold capabilities (agreed 2026-06-11, plan doc retired):
 *
 * - `quotes` — typed-inject class use cases, abstract-class ports, TWO
 *   adapters per port story: in-memory (server entry) and Dexie (browser
 *   entry — versioned schema = migrations, populate = seed), domain error
 *   mapped to the contract's declared 409, Zod edge validation shared with
 *   the ui's UForm.
 * - `users` — a `current-user` port with a stub adapter behind GET /api/me,
 *   making the example multi-module (two contract groups registered).
 *
 * Composition is split per environment: `local.ts` (browser) wires Dexie,
 * `main.ts` (server) wires in-memory + logger + cors. Suffix-free file names
 * throughout (Meridian §9.1). This is what `meridian init --ts-backend` calls.
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
  "export type UserDto = {",
  "  id: string;",
  "  name: string;",
  "};",
  "",
  "export type ApiError = {",
  "  code: string;",
  "  message: string;",
  "};",
  "",
  "export type ValidationError = {",
  "  code: string;",
  "  message: string;",
  "  errors: Record<string, string[]>;",
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
  "    errors: [",
  '      { status: 409; response: ApiError; description: "Duplicate quote text" },',
  '      { status: 422; response: ValidationError; description: "Validation failed" },',
  "    ];",
  '    summary: "Add a quote";',
  "  }>;",
  "}",
  "",
  'export interface UsersContract extends Contract<"Users"> {',
  "  Me: Endpoint<{",
  '    method: "GET";',
  '    route: "/api/me";',
  "    response: UserDto;",
  '    summary: "The current user";',
  "  }>;",
  "}",
  "",
].join("\n");

/* ─── quotes module ────────────────────────────────────────────────────────── */

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

const SEED_QUOTE_SOURCE = [
  'import type { Quote } from "../domain/quote.js";',
  "",
  "// Shared seed: the in-memory adapter starts with it; the Dexie adapter",
  "// plants it once via the populate event (first run only).",
  "export const seedQuotes: Quote[] = [",
  "  {",
  '    id: "8b1c5d9e-0000-4000-8000-000000000001",',
  '    text: "Never cross; always Common.",',
  '    author: "Meridian doctrine",',
  '    addedAt: "2026-06-10T00:00:00.000Z",',
  "  },",
  "];",
  "",
].join("\n");

const INFRA_MEMORY_STORE_SOURCE = [
  'import { QuoteStore } from "../application/ports/quote-store.js";',
  'import type { Quote } from "../domain/quote.js";',
  'import { seedQuotes } from "./seed-quotes.js";',
  "",
  "export class InMemoryQuoteStore implements QuoteStore {",
  "  private readonly quotes: Quote[] = [...seedQuotes];",
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

const INFRA_DEXIE_STORE_SOURCE = [
  'import Dexie, { type EntityTable } from "dexie";',
  'import { QuoteStore } from "../application/ports/quote-store.js";',
  'import type { Quote } from "../domain/quote.js";',
  'import { seedQuotes } from "./seed-quotes.js";',
  "",
  "// Browser persistence behind the same port the in-memory adapter serves.",
  "// Dexie versions ARE the migration story: bump .version(n) with an",
  "// .upgrade() callback when the shape changes; existing browsers migrate",
  "// in place on next load.",
  "class QuotesDatabase extends Dexie {",
  '  public quotes!: EntityTable<Quote, "id">;',
  "",
  "  public constructor(name: string) {",
  "    super(name);",
  '    this.version(1).stores({ quotes: "id" });',
  '    this.on("populate", () => {',
  "      void this.quotes.bulkAdd(seedQuotes);",
  "    });",
  "  }",
  "}",
  "",
  "export class DexieQuoteStore implements QuoteStore {",
  "  private readonly db: QuotesDatabase;",
  "",
  '  public constructor(databaseName = "quotes") {',
  "    this.db = new QuotesDatabase(databaseName);",
  "  }",
  "",
  "  public list(): Promise<Quote[]> {",
  "    return this.db.quotes.toArray();",
  "  }",
  "",
  "  public async add(quote: Quote): Promise<void> {",
  "    await this.db.quotes.add(quote);",
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

/* ─── users module ─────────────────────────────────────────────────────────── */

const PORT_CURRENT_USER_SOURCE = [
  'import type { User } from "../../domain/user.js";',
  "",
  "export abstract class CurrentUser {",
  "  private constructor() {}",
  "",
  "  abstract get(): Promise<User>;",
  "}",
  "",
].join("\n");

const DOMAIN_USER_SOURCE = [
  "export type User = {",
  "  id: string;",
  "  name: string;",
  "};",
  "",
].join("\n");

const INFRA_STUB_CURRENT_USER_SOURCE = [
  'import { CurrentUser } from "../application/ports/current-user.js";',
  'import type { User } from "../domain/user.js";',
  "",
  "// Local development identity. When the api is promoted to a real server,",
  "// replace with an adapter reading the authenticated principal (e.g. a",
  "// Hono jwt/cookie middleware sets it per request).",
  "export class StubCurrentUser implements CurrentUser {",
  "  public get(): Promise<User> {",
  '    return Promise.resolve({ id: "00000000-0000-4000-8000-00000000dev0", name: "Local Dev" });',
  "  }",
  "}",
  "",
].join("\n");

const USE_CASE_GET_CURRENT_USER_SOURCE = [
  'import type { User } from "../domain/user.js";',
  'import { CurrentUser } from "./ports/current-user.js";',
  "",
  "export class GetCurrentUser {",
  '  public static inject = ["currentUser"] as const;',
  "",
  "  public constructor(private readonly currentUser: CurrentUser) {}",
  "",
  "  public execute(): Promise<User> {",
  "    return this.currentUser.get();",
  "  }",
  "}",
  "",
].join("\n");

/* ─── edge: validation + routes ────────────────────────────────────────────── */

const VALIDATION_QUOTES_SOURCE = [
  'import { z } from "zod";',
  'import type { AddQuoteRequest } from "../../contracts.js";',
  "",
  "// Edge validation, shared with the ui's UForm (imported via",
  '// "<scope>/api/validation"). The `satisfies` clause locks the schema to the',
  "// contract type: change the contract and tsc points here until the schema",
  "// agrees. Rules beyond shape (lengths, trims) live ONLY here — the contract",
  "// cannot express them.",
  "export const addQuoteRequest = z.object({",
  '  text: z.string().trim().min(1, "Text is required.").max(500, "Keep quotes under 500 characters."),',
  '  author: z.string().trim().min(1, "Author is required.").max(100, "Keep authors under 100 characters."),',
  "}) satisfies z.ZodType<AddQuoteRequest>;",
  "",
].join("\n");

const VALIDATION_INDEX_SOURCE = ['export { addQuoteRequest } from "./quotes.js";', ""].join("\n");

const ROUTES_QUOTES_SOURCE = [
  'import type { Hono } from "hono";',
  'import { type ContractJson, registerRivetHonoRoutes, rivetHttpError } from "rivet-ts/hono";',
  'import { z } from "zod";',
  'import type { QuotesContract } from "#contract";',
  'import type { AddQuote } from "../../modules/quotes/application/add-quote.js";',
  'import type { ListQuotes } from "../../modules/quotes/application/list-quotes.js";',
  'import { DuplicateQuoteError } from "../../modules/quotes/domain/duplicate-quote-error.js";',
  'import { addQuoteRequest } from "../validation/quotes.js";',
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
  "        // The wire is untrusted: parse before the use case sees it.",
  "        const parsed = addQuoteRequest.safeParse(body);",
  "        if (!parsed.success) {",
  "          throw rivetHttpError(422, {",
  '            code: "validation_failed",',
  '            message: "Validation failed.",',
  "            errors: z.flattenError(parsed.error).fieldErrors,",
  "          });",
  "        }",
  "",
  "        try {",
  "          return await useCases.addQuote.execute(parsed.data);",
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

const ROUTES_USERS_SOURCE = [
  'import type { Hono } from "hono";',
  'import { type ContractJson, registerRivetHonoRoutes } from "rivet-ts/hono";',
  'import type { UsersContract } from "#contract";',
  'import type { GetCurrentUser } from "../../modules/users/application/get-current-user.js";',
  "",
  "export type UsersUseCases = {",
  "  getCurrentUser: GetCurrentUser;",
  "};",
  "",
  "export const registerUsersRoutes = (",
  "  app: Hono,",
  "  contract: ContractJson,",
  "  useCases: UsersUseCases,",
  "): void => {",
  "  registerRivetHonoRoutes<UsersContract>(app, contract, {",
  '    group: "users",',
  "    handlers: {",
  "      Me: () => useCases.getCurrentUser.execute(),",
  "    },",
  "  });",
  "};",
  "",
].join("\n");

/* ─── composition + entries ────────────────────────────────────────────────── */

const COMPOSITION_SOURCE = [
  'import { createInjector } from "typed-inject";',
  'import type { QuotesUseCases } from "./interface/http/quotes-routes.js";',
  'import type { UsersUseCases } from "./interface/http/users-routes.js";',
  'import { AddQuote } from "./modules/quotes/application/add-quote.js";',
  'import { ListQuotes } from "./modules/quotes/application/list-quotes.js";',
  'import type { QuoteStore } from "./modules/quotes/application/ports/quote-store.js";',
  'import { SystemClock } from "./modules/quotes/infrastructure/system-clock.js";',
  'import { GetCurrentUser } from "./modules/users/application/get-current-user.js";',
  'import { StubCurrentUser } from "./modules/users/infrastructure/stub-current-user.js";',
  "",
  "export type AppUseCases = QuotesUseCases & UsersUseCases;",
  "",
  "// The persistence adapter is the ONLY thing the two entries disagree on:",
  "// local.ts (browser) passes the Dexie store, main.ts (server) the in-memory",
  "// one. Everything above infrastructure is identical in both worlds.",
  "export const composeApp = (adapters: { quoteStore: QuoteStore }): AppUseCases => {",
  "  const injector = createInjector()",
  '    .provideValue("clock", new SystemClock())',
  '    .provideValue("quoteStore", adapters.quoteStore)',
  '    .provideValue("currentUser", new StubCurrentUser());',
  "",
  "  return {",
  "    addQuote: injector.injectClass(AddQuote),",
  "    listQuotes: injector.injectClass(ListQuotes),",
  "    getCurrentUser: injector.injectClass(GetCurrentUser),",
  "  };",
  "};",
  "",
].join("\n");

const APP_SOURCE = [
  'import { Hono } from "hono";',
  'import { cors } from "hono/cors";',
  'import { logger } from "hono/logger";',
  'import contract from "../generated/api.contract.json" with { type: "json" };',
  'import type { AppUseCases } from "./composition.js";',
  'import { registerQuotesRoutes } from "./interface/http/quotes-routes.js";',
  'import { registerUsersRoutes } from "./interface/http/users-routes.js";',
  "",
  "export type CreateAppOptions = {",
  "  // Server-entry concerns; the in-browser transport needs neither.",
  "  readonly logger?: boolean;",
  "  readonly cors?: boolean;",
  "};",
  "",
  "export const createApp = (useCases: AppUseCases, options: CreateAppOptions = {}): Hono => {",
  "  const app = new Hono();",
  "",
  "  if (options.logger) {",
  "    app.use(logger());",
  "  }",
  "  if (options.cors) {",
  "    app.use(cors());",
  "  }",
  "",
  "  registerQuotesRoutes(app, contract, useCases);",
  "  registerUsersRoutes(app, contract, useCases);",
  "",
  "  // Unhandled handler errors become a structured 500 in BOTH the local",
  "  // (in-browser) transport and a real server — same envelope, same status,",
  '  // keeping the "local now, server later" behavioral parity promise.',
  "  app.onError((error, context) => {",
  "    console.error(error);",
  '    return context.json({ code: "internal_error", message: "Unexpected error." }, 500);',
  "  });",
  "",
  "  return app;",
  "};",
  "",
].join("\n");

const LOCAL_SOURCE = [
  'import { composeApp } from "./composition.js";',
  'import { createApp } from "./app.js";',
  'import { DexieQuoteStore } from "./modules/quotes/infrastructure/dexie-quote-store.js";',
  "",
  "// Browser entry: the whole api runs in the page, persisting to IndexedDB.",
  "export const app = createApp(composeApp({ quoteStore: new DexieQuoteStore() }));",
  "",
].join("\n");

const MAIN_SOURCE = [
  'import { serve } from "@hono/node-server";',
  'import { composeApp } from "./composition.js";',
  'import { createApp } from "./app.js";',
  'import { InMemoryQuoteStore } from "./modules/quotes/infrastructure/in-memory-quote-store.js";',
  "",
  "// Server entry: same use cases, server-grade edges. Swap the in-memory",
  "// store for a real database adapter when one exists — nothing above",
  "// infrastructure changes.",
  "const app = createApp(composeApp({ quoteStore: new InMemoryQuoteStore() }), {",
  "  logger: true,",
  "  cors: true,",
  "});",
  "",
  "serve({ fetch: app.fetch, port: 5180 }, (info) => {",
  "  console.log(`api listening on http://localhost:${info.port}`);",
  "});",
  "",
].join("\n");

/* ─── ui: UForm page sharing the api's schemas ─────────────────────────────── */

const buildAppVueSource = (packageScope: string): string =>
  [
    '<script setup lang="ts">',
    `import { addQuoteRequest } from "${packageScope}/api/validation";`,
    `import { client } from "${packageScope}/contracts";`,
    'import { reactive, ref } from "vue";',
    "",
    "// The SAME schema validates this form and the api's front door — edit a",
    "// rule in interface/validation/quotes.ts and both change together.",
    "const state = reactive({ text: \"\", author: \"\" });",
    "const serverError = ref<string | null>(null);",
    "const quotes = ref<Array<{ id: string; text: string; author: string }>>([]);",
    "",
    "// openapi-fetch never throws on HTTP errors — always handle { data, error }.",
    "const { data: me, error: meError } = await client.GET(\"/api/me\");",
    "",
    "async function refreshQuotes() {",
    "  const { data, error } = await client.GET(\"/api/quotes\");",
    "  if (!error) {",
    "    quotes.value = data ?? [];",
    "  }",
    "}",
    "",
    "await refreshQuotes();",
    "",
    "async function onSubmit() {",
    "  serverError.value = null;",
    "  const { error } = await client.POST(\"/api/quotes\", { body: { ...state } });",
    "  if (error) {",
    "    serverError.value = (error as { message?: string }).message ?? \"Request failed.\";",
    "    return;",
    "  }",
    "  state.text = \"\";",
    "  state.author = \"\";",
    "  await refreshQuotes();",
    "}",
    "</script>",
    "",
    "<template>",
    "  <UApp>",
    '    <UContainer class="py-10 space-y-6">',
    "      <h1 class=\"text-xl font-semibold\">Quotes</h1>",
    '      <p v-if="me" class="text-sm text-muted">Signed in as {{ me.name }}</p>',
    '      <UAlert v-if="meError" color="error" title="Could not load the current user." />',
    "",
    '      <UForm :schema="addQuoteRequest" :state="state" class="space-y-4" @submit="onSubmit">',
    '        <UFormField label="Quote" name="text">',
    '          <UInput v-model="state.text" placeholder="Never cross; always Common." />',
    "        </UFormField>",
    '        <UFormField label="Author" name="author">',
    '          <UInput v-model="state.author" placeholder="Meridian doctrine" />',
    "        </UFormField>",
    '        <UButton type="submit">Add quote</UButton>',
    '        <UAlert v-if="serverError" color="error" :title="serverError" />',
    "      </UForm>",
    "",
    "      <ul class=\"space-y-2\">",
    '        <li v-for="quote in quotes" :key="quote.id">',
    "          <blockquote>{{ quote.text }} — <em>{{ quote.author }}</em></blockquote>",
    "        </li>",
    "      </ul>",
    "    </UContainer>",
    "  </UApp>",
    "</template>",
    "",
  ].join("\n");

/* ─── tests ────────────────────────────────────────────────────────────────── */

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

const TEST_VALIDATION_SOURCE = [
  'import { describe, expect, it } from "vitest";',
  'import { addQuoteRequest } from "../src/interface/validation/quotes.js";',
  "",
  'describe("addQuoteRequest", () => {',
  '  it("rejects blank text with a field error", () => {',
  '    const result = addQuoteRequest.safeParse({ text: "   ", author: "Max" });',
  "    expect(result.success).toBe(false);",
  "  });",
  "",
  '  it("trims accepted input", () => {',
  '    const result = addQuoteRequest.parse({ text: " Ship it. ", author: " Max " });',
  '    expect(result.text).toBe("Ship it.");',
  "  });",
  "});",
  "",
].join("\n");

/* ─── orchestration ────────────────────────────────────────────────────────── */

export type ExampleProjectConfig = {
  readonly outDir: string;
  readonly projectName: string;
  readonly force: boolean;
  readonly document: RivetContractDocument;
};

/**
 * Emits the workspace skeleton plus the worked example modules. The caller
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
  const packageScope = toPackageScope(config.projectName);

  const workspaceConfig: WorkspaceConfig = {
    outDir: config.outDir,
    projectName: config.projectName,
    packageScope,
    rivetTsDependency: toRivetTsDependency(manifest),
    versions: resolveWorkspaceVersions(manifest),
    contractEntryRelativePath: "contracts.ts",
    contractNames: ["QuotesContract", "UsersContract"],
    bootstrapOpenApiDocument: buildBootstrapOpenApiDocument(config),
    appVueSource: buildAppVueSource(packageScope),
    extraApiDependencies: { dexie: "^4.0.0", "typed-inject": "^5.0.0" },
  };

  const { apiRoot, apiSourceRoot } = await emitWorkspaceSkeleton(
    workspaceConfig,
    `${JSON.stringify(config.document, null, 2)}\n`,
  );

  const quotesRoot = path.join(apiSourceRoot, "modules", "quotes");
  const usersRoot = path.join(apiSourceRoot, "modules", "users");
  await Promise.all([
    fs.mkdir(path.join(quotesRoot, "domain"), { recursive: true }),
    fs.mkdir(path.join(quotesRoot, "application", "ports"), { recursive: true }),
    fs.mkdir(path.join(quotesRoot, "infrastructure"), { recursive: true }),
    fs.mkdir(path.join(usersRoot, "domain"), { recursive: true }),
    fs.mkdir(path.join(usersRoot, "application", "ports"), { recursive: true }),
    fs.mkdir(path.join(usersRoot, "infrastructure"), { recursive: true }),
    fs.mkdir(path.join(apiSourceRoot, "interface", "http"), { recursive: true }),
    fs.mkdir(path.join(apiSourceRoot, "interface", "validation"), { recursive: true }),
    fs.mkdir(path.join(apiRoot, "test", "support"), { recursive: true }),
  ]);

  const writeApi = (relativePath: string, source: string) =>
    fs.writeFile(path.join(apiSourceRoot, relativePath), source);

  await Promise.all([
    writeApi("contracts.ts", CONTRACTS_SOURCE),
    writeApi("app.ts", APP_SOURCE),
    writeApi("composition.ts", COMPOSITION_SOURCE),
    writeApi("local.ts", LOCAL_SOURCE),
    writeApi("main.ts", MAIN_SOURCE),
    writeApi(path.join("interface", "http", "quotes-routes.ts"), ROUTES_QUOTES_SOURCE),
    writeApi(path.join("interface", "http", "users-routes.ts"), ROUTES_USERS_SOURCE),
    writeApi(path.join("interface", "validation", "quotes.ts"), VALIDATION_QUOTES_SOURCE),
    writeApi(path.join("interface", "validation", "index.ts"), VALIDATION_INDEX_SOURCE),
    writeApi(path.join("modules", "quotes", "domain", "quote.ts"), DOMAIN_QUOTE_SOURCE),
    writeApi(
      path.join("modules", "quotes", "domain", "duplicate-quote-error.ts"),
      DOMAIN_ERROR_SOURCE,
    ),
    writeApi(
      path.join("modules", "quotes", "application", "ports", "quote-store.ts"),
      PORT_QUOTE_STORE_SOURCE,
    ),
    writeApi(path.join("modules", "quotes", "application", "ports", "clock.ts"), PORT_CLOCK_SOURCE),
    writeApi(path.join("modules", "quotes", "application", "add-quote.ts"), USE_CASE_ADD_QUOTE_SOURCE),
    writeApi(
      path.join("modules", "quotes", "application", "list-quotes.ts"),
      USE_CASE_LIST_QUOTES_SOURCE,
    ),
    writeApi(path.join("modules", "quotes", "infrastructure", "seed-quotes.ts"), SEED_QUOTE_SOURCE),
    writeApi(
      path.join("modules", "quotes", "infrastructure", "in-memory-quote-store.ts"),
      INFRA_MEMORY_STORE_SOURCE,
    ),
    writeApi(
      path.join("modules", "quotes", "infrastructure", "dexie-quote-store.ts"),
      INFRA_DEXIE_STORE_SOURCE,
    ),
    writeApi(path.join("modules", "quotes", "infrastructure", "system-clock.ts"), INFRA_CLOCK_SOURCE),
    writeApi(path.join("modules", "users", "domain", "user.ts"), DOMAIN_USER_SOURCE),
    writeApi(
      path.join("modules", "users", "application", "ports", "current-user.ts"),
      PORT_CURRENT_USER_SOURCE,
    ),
    writeApi(
      path.join("modules", "users", "application", "get-current-user.ts"),
      USE_CASE_GET_CURRENT_USER_SOURCE,
    ),
    writeApi(
      path.join("modules", "users", "infrastructure", "stub-current-user.ts"),
      INFRA_STUB_CURRENT_USER_SOURCE,
    ),
    fs.writeFile(
      path.join(apiRoot, "test", "support", "fake-quote-store.ts"),
      TEST_SUPPORT_FAKE_STORE_SOURCE,
    ),
    fs.writeFile(
      path.join(apiRoot, "test", "support", "fixed-clock.ts"),
      TEST_SUPPORT_FIXED_CLOCK_SOURCE,
    ),
    fs.writeFile(path.join(apiRoot, "test", "add-quote.test.ts"), TEST_ADD_QUOTE_SOURCE),
    fs.writeFile(path.join(apiRoot, "test", "validation.test.ts"), TEST_VALIDATION_SOURCE),
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
