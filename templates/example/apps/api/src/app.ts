import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import contract from "../generated/api.contract.json" with { type: "json" };
import type { AppUseCases } from "./composition.js";
import { handleUnexpectedError } from "./http-errors.js";
import { registerQuotesRoutes } from "./modules/quotes/quotes-routes.js";
import { registerUsersRoutes } from "./modules/users/users-routes.js";

export type CreateAppOptions = {
  // Server-entry concerns; the in-browser transport needs neither.
  readonly logger?: boolean;
  readonly cors?: boolean;
};

export const createApp = (useCases: AppUseCases, options: CreateAppOptions = {}): Hono => {
  const app = new Hono();

  if (options.logger) {
    app.use(logger());
  }
  if (options.cors) {
    app.use(cors());
  }

  registerQuotesRoutes(app, contract, useCases);
  registerUsersRoutes(app, contract, useCases);

  app.onError(handleUnexpectedError);

  return app;
};
