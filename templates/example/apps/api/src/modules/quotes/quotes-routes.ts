import {
  type ContractJson,
  registerRivetHonoRoutes,
  rivetHttpError,
} from "@maxanstey-meridian/rivet-ts/hono";
import type { Hono } from "hono";
import type { QuotesContract } from "#contract";
import { parseBody } from "../../http-errors.js";
import type { AddQuote } from "./application/add-quote.js";
import type { ListQuotes } from "./application/list-quotes.js";
import { DuplicateQuoteError } from "./domain/duplicate-quote-error.js";
import { addQuoteRequest } from "./quotes-validation.js";

export type QuotesUseCases = {
  addQuote: AddQuote;
  listQuotes: ListQuotes;
};

export const registerQuotesRoutes = (
  app: Hono,
  contract: ContractJson,
  useCases: QuotesUseCases,
): void => {
  registerRivetHonoRoutes<QuotesContract>(app, contract, {
    group: "quotes",
    handlers: {
      ListQuotes: () => useCases.listQuotes.execute(),
      AddQuote: async ({ body }) => {
        const input = parseBody(addQuoteRequest, body);

        try {
          return await useCases.addQuote.execute(input);
        } catch (error) {
          // Declared failures travel as contract results, not raw exceptions.
          if (error instanceof DuplicateQuoteError) {
            throw rivetHttpError(409, { code: error.code, message: error.message });
          }
          throw error;
        }
      },
    },
  });
};
