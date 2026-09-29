import { z } from "zod";
import type { AddQuoteRequest } from "../../contracts.js";

// Edge validation, shared with the ui's UForm (imported via
// "<scope>/api/validation"). The `satisfies` clause locks the schema to the
// contract type: change the contract and tsc points here until the schema
// agrees. Rules beyond shape (lengths, trims) live ONLY here — the contract
// cannot express them.
export const addQuoteRequest = z.object({
  text: z.string().trim().min(1, "Text is required.").max(500, "Keep quotes under 500 characters."),
  author: z
    .string()
    .trim()
    .min(1, "Author is required.")
    .max(100, "Keep authors under 100 characters."),
}) satisfies z.ZodType<AddQuoteRequest>;
