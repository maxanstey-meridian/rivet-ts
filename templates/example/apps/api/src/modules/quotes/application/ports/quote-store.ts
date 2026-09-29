import type { Quote } from "../../domain/quote.js";

export abstract class QuoteStore {
  private constructor() {}

  abstract list(): Promise<Quote[]>;

  abstract add(quote: Quote): Promise<void>;
}
