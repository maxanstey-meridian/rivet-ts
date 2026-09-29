import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { composeApp } from "./composition.js";
import { InMemoryQuoteStore } from "./modules/quotes/infrastructure/in-memory-quote-store.js";

// Server entry: same use cases, server-grade edges. Swap the in-memory
// store for a real database adapter when one exists — nothing above
// infrastructure changes.
const app = createApp(composeApp({ quoteStore: new InMemoryQuoteStore() }), {
  logger: true,
  cors: true,
});

serve({ fetch: app.fetch, port: 5180 }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
