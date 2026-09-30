import { rivetHttpError } from "@maxanstey-meridian/rivet-ts/hono";
import type { ErrorHandler } from "hono";
import { z } from "zod";

// The wire is untrusted: parse a request body before any use case sees it.
// A body the schema rejects becomes the contract's 422 validation envelope.
export const parseBody = <TSchema extends z.ZodType>(
  schema: TSchema,
  body: unknown,
): z.output<TSchema> => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw rivetHttpError(422, {
      code: "validation_failed",
      message: "Validation failed.",
      errors: z.flattenError(parsed.error).fieldErrors,
    });
  }
  return parsed.data;
};

// Unhandled handler errors become a structured 500 in BOTH the local
// (in-browser) transport and a real server — same envelope, same status,
// keeping the "local now, server later" behavioral parity promise.
export const handleUnexpectedError: ErrorHandler = (error, context) => {
  console.error(error);
  return context.json({ code: "internal_error", message: "Unexpected error." }, 500);
};
