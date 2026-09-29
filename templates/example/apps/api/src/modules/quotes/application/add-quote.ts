import { DuplicateQuoteError } from "../domain/duplicate-quote-error.js";
import { quoteTextsMatch, type Quote } from "../domain/quote.js";
import { Clock } from "./ports/clock.js";
import { QuoteStore } from "./ports/quote-store.js";

export type AddQuoteInput = {
  text: string;
  author: string;
};

export class AddQuote {
  public static inject = ["quoteStore", "clock"] as const;

  public constructor(
    private readonly quoteStore: QuoteStore,
    private readonly clock: Clock,
  ) {}

  public async execute(input: AddQuoteInput): Promise<Quote> {
    const existing = await this.quoteStore.list();

    if (existing.some((quote) => quoteTextsMatch(quote.text, input.text))) {
      throw new DuplicateQuoteError(input.text);
    }

    const quote: Quote = {
      id: crypto.randomUUID(),
      text: input.text.trim(),
      author: input.author.trim(),
      addedAt: this.clock.now().toISOString(),
    };

    await this.quoteStore.add(quote);

    return quote;
  }
}
