# Hono

Use `rivet-ts/hono` when you want to mount contract-typed handlers onto a Hono app yourself instead of relying on the scaffolded `packages/api/src/api.ts`.

## What it does

`rivet-ts/hono` is the lower-level Hono integration.

You provide:

- a Hono app
- a reflected/lowered Rivet contract JSON document
- a handler map

It registers Hono routes from the contract and dispatches requests into your handlers.

## Example

```ts
import { Hono } from "hono";
import { mount } from "rivet-ts/hono";
import contract from "../generated/api.contract.json";
import { createMember } from "./handlers/create-member.js";
import { listMembers } from "./handlers/list-members.js";

export const app = new Hono();

mount(app, contract, {
  createMember,
  listMembers,
});
```

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
- you want to own `app.ts` or `api.ts` yourself
- you want the lower-level integration under the scaffold

Do not use it when:

- `scaffold-mock` already gives you the shape you want
- you do not need custom app wiring

In the scaffolded flow, `packages/api/src/api.ts` already uses this integration for you.
