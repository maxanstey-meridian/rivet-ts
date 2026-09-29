import type { QuoteStore } from "../../src/modules/quotes/application/ports/quote-store.js";
import type { Quote } from "../../src/modules/quotes/domain/quote.js";

// Fake the PORT, never the database (Meridian testing doctrine).
export class FakeQuoteStore implements QuoteStore {
  public constructor(private readonly quotes: Quote[] = []) {}

  public list(): Promise<Quote[]> {
    return Promise.resolve([...this.quotes]);
  }

  public add(quote: Quote): Promise<void> {
    this.quotes.push(quote);
    return Promise.resolve();
  }
}
