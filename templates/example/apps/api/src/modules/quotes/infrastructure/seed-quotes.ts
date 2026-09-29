import type { Quote } from "../domain/quote.js";

// Shared seed: the in-memory adapter starts with it; the Dexie adapter
// plants it once via the populate event (first run only).
export const seedQuotes: Quote[] = [
  {
    id: "8b1c5d9e-0000-4000-8000-000000000001",
    text: "Never cross; always Common.",
    author: "Meridian doctrine",
    addedAt: "2026-06-10T00:00:00.000Z",
  },
];
