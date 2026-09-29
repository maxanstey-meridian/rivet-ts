export class DuplicateQuoteError extends Error {
  public readonly code = "duplicate_quote";

  public constructor(text: string) {
    super(`A quote with the text ${JSON.stringify(text)} already exists.`);
    this.name = "DuplicateQuoteError";
  }
}
