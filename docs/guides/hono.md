# Hono

Use `rivet-ts/hono` when you want to mount contract-typed handlers onto a Hono app yourself instead of relying on the scaffolded `apps/api/src/app.ts`.

## What it does

`rivet-ts/hono` is the lower-level Hono integration.

You provide:

- a Hono app
- a reflected/lowered Rivet contract JSON document
- a handler map

It registers Hono routes from the contract onto your app and dispatches requests into your handlers.

Routes are selected from the supplied contract. If `group` is provided, an endpoint matches when either its `group` or `controllerName` equals that value. Handler keys may use the authored endpoint name or the generated runtime endpoint name, for example `CreateMember` or `createMember`, but each selected endpoint must match exactly one handler and unused handlers fail registration.

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

Handler input is derived from the endpoint spec:

- `input` becomes `body`
- `params` becomes `params`
- `query` becomes `query`
- inputless endpoints receive no argument
- `fileResponse: true` handlers are typed as returning a `Blob`

At runtime, JSON bodies use Hono request JSON parsing. `formEncoded` endpoints and multipart endpoints use Hono body parsing. Multipart endpoints pass the selected `File`/`Blob` and form fields under `body`, with route params under `params`.

## What is and isn't enforced at runtime

The contract and generated types make wrong code fail to compile; the runtime enforces only inbound request binding.

Enforced (each failure is a structured `400` with a `{ code, message }` body, and the handler is never invoked):

- missing required route or query parameters → `MISSING_REQUIRED_PARAMETER`
- route/query values that fail number or boolean coercion against the contract-declared type → `INVALID_PARAMETER_VALUE`
- a repeated query parameter the contract declares as single-valued → `REPEATED_QUERY_PARAMETER`
- a JSON request body that fails to parse → `INVALID_REQUEST_BODY`
- missing required multipart fields → `MISSING_MULTIPART_FIELD`

Array-typed query params collect repeated values (a single value arrives as a one-element array), with element-level coercion.

Not enforced by the adapter:

- **Request body shape.** The body is parsed, not schema-validated; a parseable body with missing, extra, or wrongly-typed fields reaches the handler as-is. (Scaffolded apps layer their own Zod body validation on top of this adapter — schemas beside each module's routes, returning `422 { code: "validation_failed" }` — but that is user-owned app code, not part of `rivet-ts/hono`.)
- **Response bodies.** The runtime serializes whatever the handler returns — extra fields on returned objects go to the wire. `RivetHandler` types are the only guard.
- String parameters beyond number/boolean coercion (e.g. enum-typed query params) pass through as raw strings.

## Handler forms

The handler map accepts plain functions:

```ts
const listMembers: RivetHandler<MembersContract, "List"> = async () => [];

registerRivetHonoRoutes<MembersContract>(app, contract, {
  group: "members",
  handlers: {
    List: listMembers,
  },
});
```

It also accepts classes with either a `handle` or `invoke` method:

```ts
class ListMembersHandler {
  async handle(): Promise<MemberDto[]> {
    return [];
  }
}

registerRivetHonoRoutes<MembersContract>(app, contract, {
  group: "members",
  handlers: {
    List: ListMembersHandler,
  },
});
```

Classes are resolved per request. Zero-argument classes are constructed by the integration. Classes with constructor dependencies require `resolveHandler`; the resolver also receives the current Hono `Context`:

```ts
registerRivetHonoRoutes<MembersContract>(app, contract, {
  group: "members",
  handlers: {
    List: ListMembersHandler,
  },
  resolveHandler: (Handler, context) => container.resolve(Handler, context),
});
```

Per-endpoint Hono middleware can be attached with a rich handler entry:

```ts
registerRivetHonoRoutes<MembersContract>(app, contract, {
  group: "members",
  handlers: {
    List: {
      handler: listMembers,
      middleware: [authMiddleware],
    },
  },
});
```

## Error and File Responses

Throw `rivetHttpError(status, data, options)` from a handler to return an explicit non-2xx response:

```ts
import { rivetHttpError } from "rivet-ts/hono";

throw rivetHttpError(409, { code: "conflict" });
```

For file responses, set `fileResponse: true` and `fileContentType` in the contract. The Hono integration accepts `Blob`, `string`, `ArrayBuffer`, `Uint8Array`, or `ReadableStream` from the handler and writes the configured content type.

## When to use it

Use `rivet-ts/hono` when:

- you already have your own app structure
- you want to own `app.ts` yourself
- you want the lower-level integration under the scaffold

Do not use it when:

- `scaffold-mock` already gives you the shape you want
- you do not need custom app wiring

In the scaffolded flow, `apps/api/src/app.ts` and the per-module `apps/api/src/modules/<module>/<module>-routes.ts` files already use this integration for you.
