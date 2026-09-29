import { Hono } from "hono";
import { type ContractJson, registerRivetHonoRoutes } from "../../src/hono.js";
import type { DirectoryContract } from "../fixtures/hono-runtime/directory.js";

declare const contract: ContractJson;
declare const handlers: Parameters<
  typeof registerRivetHonoRoutes<DirectoryContract>
>[2]["handlers"];

type AppEnv = {
  Bindings: { readonly DATABASE_URL: string };
  Variables: { readonly requestId: string };
};

describe("registerRivetHonoRoutes app types", () => {
  it("accepts an app with a typed Env when only the contract is passed", () => {
    registerRivetHonoRoutes<DirectoryContract>(new Hono<AppEnv>(), contract, { handlers });
  });

  it("returns the app it was given", () => {
    const app = new Hono<AppEnv>();
    const registered = registerRivetHonoRoutes<DirectoryContract, typeof app>(app, contract, {
      handlers,
    });

    expectTypeOf(registered).toEqualTypeOf(app);
  });

  it("accepts an app with a base path", () => {
    const app = new Hono<AppEnv>().basePath("/api");
    const registered = registerRivetHonoRoutes<DirectoryContract, typeof app>(app, contract, {
      handlers,
    });

    expectTypeOf(registered).toEqualTypeOf(app);
  });

  it("accepts a chained app that has accumulated a route schema", () => {
    const app = new Hono<AppEnv>().get("/health", (context) => context.json({ ok: true }));
    const registered = registerRivetHonoRoutes<DirectoryContract, typeof app>(app, contract, {
      handlers,
    });

    expectTypeOf(registered).toEqualTypeOf(app);
  });

  it("rejects a value that is not a Hono app", () => {
    // @ts-expect-error — the routes are registered on a Hono app.
    registerRivetHonoRoutes<DirectoryContract>({}, contract, { handlers });
  });
});
