import { Hono } from "hono";
import { registerRivetHonoRoutes } from "rivet-ts/hono";
import type { MembersContract } from "#contract";
import contract from "../generated/api.contract.json";
import { compose } from "./app/composition.js";
import { tryMapContractError } from "./interface/http/map-contract-error.js";
import { createHandler } from "./modules/members/interface/http/create.js";
import { listHandler } from "./modules/members/interface/http/list.js";

compose();

export const app = new Hono();

registerRivetHonoRoutes<MembersContract>(app, contract, {
  handlers: {
    List: listHandler,
    Create: createHandler,
  },
  group: "members",
});

app.onError((error, context) => {
  const response = tryMapContractError(error, context);
  if (response !== null) {
    return response;
  }

  throw error;
});
