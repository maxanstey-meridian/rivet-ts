import type { Context } from "hono";

/* App-level transport error hook. Return null when this error is not handled here; app.ts will rethrow it. */
export const tryMapContractError = (_error: unknown, _context: Context): Response | null => {
  return null;
};
