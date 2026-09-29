import { createInjector } from "typed-inject";
import { AddQuote } from "./application/add-quote.js";
import { ListQuotes } from "./application/list-quotes.js";
import type { QuoteStore } from "./application/ports/quote-store.js";
import { SystemClock } from "./infrastructure/system-clock.js";
import type { QuotesUseCases } from "./quotes-routes.js";

// The module owns its internal wiring (FABLE_CONTRACT §9.10); the
// composition root only supplies the adapters the environments disagree on.
export const createQuotesModule = (adapters: { quoteStore: QuoteStore }): QuotesUseCases => {
  const injector = createInjector()
    .provideValue("clock", new SystemClock())
    .provideValue("quoteStore", adapters.quoteStore);

  return {
    addQuote: injector.injectClass(AddQuote),
    listQuotes: injector.injectClass(ListQuotes),
  };
};
