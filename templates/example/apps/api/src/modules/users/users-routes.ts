import { type ContractJson, registerRivetHonoRoutes } from "@maxanstey-meridian/rivet-ts/hono";
import type { Hono } from "hono";
import type { UsersContract } from "#contract";
import type { GetCurrentUser } from "./application/get-current-user.js";

export type UsersUseCases = {
  getCurrentUser: GetCurrentUser;
};

export const registerUsersRoutes = (
  app: Hono,
  contract: ContractJson,
  useCases: UsersUseCases,
): void => {
  registerRivetHonoRoutes<UsersContract>(app, contract, {
    group: "users",
    handlers: {
      Me: () => useCases.getCurrentUser.execute(),
    },
  });
};
