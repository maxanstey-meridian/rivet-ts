import { describe, expect, it } from "vitest";
import { AddQuote } from "../src/modules/quotes/application/add-quote.js";
import { DuplicateQuoteError } from "../src/modules/quotes/domain/duplicate-quote-error.js";
import { FakeQuoteStore } from "./support/fake-quote-store.js";
import { FixedClock } from "./support/fixed-clock.js";

describe("AddQuote", () => {
  it("stores a trimmed quote stamped by the clock", async () => {
    const store = new FakeQuoteStore();
    const useCase = new AddQuote(store, new FixedClock());

    const quote = await useCase.execute({ text: "  Ship it.  ", author: " Max " });

    expect(quote.text).toBe("Ship it.");
    expect(quote.author).toBe("Max");
    expect(quote.addedAt).toBe("2026-01-01T00:00:00.000Z");
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it("rejects duplicate text regardless of casing and padding", async () => {
    const store = new FakeQuoteStore([
      {
        id: "00000000-0000-4000-8000-000000000001",
        text: "Ship it.",
        author: "Max",
        addedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const useCase = new AddQuote(store, new FixedClock());

    await expect(useCase.execute({ text: " ship it. ", author: "Someone" })).rejects.toThrow(
      DuplicateQuoteError,
    );
  });
});
