import { QuoteStore } from "../application/ports/quote-store.js";
import type { Quote } from "../domain/quote.js";
import { seedQuotes } from "./seed-quotes.js";

export class InMemoryQuoteStore implements QuoteStore {
  private readonly quotes: Quote[] = [...seedQuotes];

  public list(): Promise<Quote[]> {
    return Promise.resolve([...this.quotes]);
  }

  public add(quote: Quote): Promise<void> {
    this.quotes.push(quote);
    return Promise.resolve();
  }
}
