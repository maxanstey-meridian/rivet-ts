import type { Quote } from "../domain/quote.js";
import { QuoteStore } from "./ports/quote-store.js";

export class ListQuotes {
  public static inject = ["quoteStore"] as const;

  public constructor(private readonly quoteStore: QuoteStore) {}

  public execute(): Promise<Quote[]> {
    return this.quoteStore.list();
  }
}
