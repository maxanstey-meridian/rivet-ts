import { describe, expect, it } from "vitest";
import { addQuoteRequest } from "../src/modules/quotes/quotes-validation.js";

describe("addQuoteRequest", () => {
  it("rejects blank text with a field error", () => {
    const result = addQuoteRequest.safeParse({ text: "   ", author: "Max" });
    expect(result.success).toBe(false);
  });

  it("trims accepted input", () => {
    const result = addQuoteRequest.parse({ text: " Ship it. ", author: " Max " });
    expect(result.text).toBe("Ship it.");
  });
});
