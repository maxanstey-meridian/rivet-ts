import Dexie, { type EntityTable } from "dexie";
import { QuoteStore } from "../application/ports/quote-store.js";
import type { Quote } from "../domain/quote.js";
import { seedQuotes } from "./seed-quotes.js";

// Browser persistence behind the same port the in-memory adapter serves.
// Dexie versions ARE the migration story: bump .version(n) with an
// .upgrade() callback when the shape changes; existing browsers migrate
// in place on next load.
class QuotesDatabase extends Dexie {
  public quotes!: EntityTable<Quote, "id">;

  public constructor(name: string) {
    super(name);
    this.version(1).stores({ quotes: "id" });
    this.on("populate", () => {
      void this.quotes.bulkAdd(seedQuotes);
    });
  }
}

export class DexieQuoteStore implements QuoteStore {
  private readonly db: QuotesDatabase;

  public constructor(databaseName = "quotes") {
    this.db = new QuotesDatabase(databaseName);
  }

  public list(): Promise<Quote[]> {
    return this.db.quotes.toArray();
  }

  public async add(quote: Quote): Promise<void> {
    await this.db.quotes.add(quote);
  }
}
