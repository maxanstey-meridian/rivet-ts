import { createInjector } from "typed-inject";
import { GetCurrentUser } from "./application/get-current-user.js";
import { StubCurrentUser } from "./infrastructure/stub-current-user.js";
import type { UsersUseCases } from "./users-routes.js";

// No environment-dependent adapters yet: the dev stub IS the wiring. Swap
// it for a real identity adapter here when one exists.
export const createUsersModule = (): UsersUseCases => {
  const injector = createInjector().provideValue("currentUser", new StubCurrentUser());

  return {
    getCurrentUser: injector.injectClass(GetCurrentUser),
  };
};
