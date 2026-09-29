import { createApp } from "./app.js";
import { composeApp } from "./composition.js";
import { DexieQuoteStore } from "./modules/quotes/infrastructure/dexie-quote-store.js";

// Browser entry: the whole api runs in the page, persisting to IndexedDB.
export const app = createApp(composeApp({ quoteStore: new DexieQuoteStore() }));
