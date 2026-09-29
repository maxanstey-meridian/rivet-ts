import type { QuoteStore } from "./modules/quotes/application/ports/quote-store.js";
import type { QuotesUseCases } from "./modules/quotes/quotes-routes.js";
import { createQuotesModule } from "./modules/quotes/quotes.module.js";
import type { UsersUseCases } from "./modules/users/users-routes.js";
import { createUsersModule } from "./modules/users/users.module.js";

export type AppUseCases = QuotesUseCases & UsersUseCases;

// The persistence adapter is the ONLY thing the two entries disagree on:
// local.ts (browser) passes the Dexie store, main.ts (server) the in-memory
// one. Each module wires its own internals in <module>.module.ts.
export const composeApp = (adapters: { quoteStore: QuoteStore }): AppUseCases => ({
  ...createQuotesModule({ quoteStore: adapters.quoteStore }),
  ...createUsersModule(),
});
