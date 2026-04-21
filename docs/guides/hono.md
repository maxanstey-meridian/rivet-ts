# Hono

Use `rivet-ts/hono` when you want to mount contract-typed handlers onto a Hono app yourself instead of relying on the scaffolded `packages/api/src/app.ts`.

## What it does

`rivet-ts/hono` is the lower-level Hono integration.

You provide:

- a Hono app
- a reflected/lowered Rivet contract JSON document
- a handler map

It registers Hono routes from the contract onto your app and dispatches requests into your handlers.

## Example

```ts
import { Hono } from "hono";
import { contextStorage } from "hono/context-storage";
import { registerRivetHonoRoutes } from "rivet-ts/hono";
import contract from "../generated/api.contract.json";
import { composeApi } from "./composition.js";
import { CreateMemberHandler } from "./handlers/create-member.js";
import { ListMembersHandler } from "./handlers/list-members.js";

const container = composeApi();
export const app = new Hono();
app.use("/api/*", contextStorage());

registerRivetHonoRoutes(app, contract, {
  handlers: {
    Create: CreateMemberHandler,
    List: ListMembersHandler,
  },
  resolveHandler: (Handler) => container.resolve(Handler),
});
```

## Request-aware services

If your application services need ambient access to the current Hono request, install `contextStorage()` in the app and keep that concern in an app-owned abstraction such as `RequestContext`.

`rivet-ts/hono` does not provide request-scoped DI or its own request lifecycle.

## Handler typing

Handlers can still be typed directly against the contract:

```ts
import type { RivetHandler } from "rivet-ts";
import type { MembersContract } from "./contracts.js";

export const listMembers: RivetHandler<MembersContract, "List"> = async () => {
  return [];
};
```

## When to use it

Use `rivet-ts/hono` when:

- you already have your own app structure
- you want to own `app.ts` yourself
- you want the lower-level integration under the scaffold

Do not use it when:

- `scaffold-mock` already gives you the shape you want
- you do not need custom app wiring

In the scaffolded flow, `packages/api/src/app.ts` already uses this integration for you.
