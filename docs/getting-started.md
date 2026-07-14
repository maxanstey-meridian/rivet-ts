# Getting Started

1. install `rivet-ts`
2. scaffold a workspace (or write a contract first and scaffold mocks from it)
3. run `task install && task dev`
4. open `apps/ui/app/app.vue` and start consuming the typed client

## 1. Install

```bash
pnpm add -D github:maxanstey-meridian/rivet-ts#v0.13.0
```

`rivet-ts` is installed from the versioned Git tag; it is not published to the
npm registry.

The Rivet binary (the OpenAPI emitter) is downloaded and cached automatically
on first use — both by the Vite plugin and by the `rivet-ts rivet --` CLI
passthrough that scaffolded `task generate` pipelines call. Nothing needs to be
on `PATH`.

## 2a. Scaffold a fresh workspace

```bash
pnpm exec rivet-ts scaffold --out ./myapp --name myapp
cd ./myapp
task install
task dev
```

This emits the golden workspace shape with one worked example module
(`quotes`): typed-inject use cases, abstract-class ports, an in-memory adapter,
a domain error mapped to the contract's declared 409 at the transport edge, and
vitest tests faking the port.

```text
myapp/
├── Taskfile.yml             ← install / dev / generate / api:run / api:test / plumb
├── .oxlintrc.json / .oxfmtrc.json / .editorconfig / .gitignore
├── apps/
│   ├── api/                 ← Hono backend
│   │   ├── generated/api.contract.json
│   │   └── src/
│   │       ├── contracts.ts ← the contract entry (source of truth)
│   │       ├── app.ts / composition.ts / main.ts / local.ts
│   │       └── modules/{quotes,users}/
│   │           ├── {domain,application,infrastructure}/
│   │           ├── {quotes,users}-routes.ts
│   │           └── {quotes,users}-validation.ts ← user-owned Zod edge schemas
│   └── ui/                  ← Nuxt SPA (ssr: false)
│       └── app/plugins/rivet.client.ts   ← local in-browser transport
└── packages/contracts/
    ├── generated/           ← read-only: openapi.json + schema.d.ts
    └── src/index.ts         ← hand-owned typed client facade
```

File naming is suffix-free throughout (`add-quote.ts`, not
`add-quote.use-case.ts`): the directory carries the role.

The example also ships the bread-and-butter backend capabilities: Zod
validation at the route edge (schemas beside their module routes, locked to the
contract types with `satisfies` — the ui's `UForm` consumes the SAME schemas
via `@myapp/api/validation`), Dexie persistence in the browser
(versioned schemas are the migration story; the server entry wires the
in-memory adapter instead), a `current-user` port with a dev stub behind
`GET /api/me`, and request logging + CORS on the server entry only.
`scaffold-mock` synthesizes shape-level Zod schemas from your contract the
same way — owned by you after emission; tighten them with real rules, or pass
`--spec <openapi.json>` to chain the spec's JSON Schema constraints (lengths,
bounds, patterns, item counts) onto them at scaffold time.

## 2b. Or scaffold mocks from an existing contract

Write `contracts.ts`:

```ts
import type { Contract, Endpoint } from "rivet-ts";

export interface MemberDto {
  id: string;
  email: string;
}

export interface CreateMemberRequest {
  email: string;
}

export interface MembersContract extends Contract<"MembersContract"> {
  List: Endpoint<{
    method: "GET";
    route: "/api/members";
    response: MemberDto[];
  }>;

  Create: Endpoint<{
    method: "POST";
    route: "/api/members";
    input: CreateMemberRequest;
    response: MemberDto;
    successStatus: 201;
  }>;
}
```

```bash
pnpm exec rivet-ts scaffold-mock --entry ./contracts.ts --out ./myapp
```

Same workspace shape; the api modules return synthesized mock values
(`modules/members/application/list.ts` etc.) until you replace them with real
use cases. Re-running over an existing directory refuses to clobber your edits
unless you pass `--force`.

## 3. The dev loop

- `task dev` — the Nuxt frontend; the whole API runs **in the browser**,
  dispatched through `app.request` (wired once in
  `apps/ui/app/plugins/rivet.client.ts`).
- `task generate` — contract entry → `api.contract.json` → `openapi.json`
  (Rivet binary) → `schema.d.ts` (openapi-typescript). Run after contract
  changes.
- `task api:run` — promote the API to a real server; point the UI at it by
  swapping the plugin's fetch dispatch for `{ baseUrl }`.
- `task api:test` — typecheck + vitest.
- `task plumb` — Meridian doctrine check (zero findings on a fresh scaffold).

## 4. Consuming the client

```ts
import { client } from "@myapp/contracts";

const { data, error } = await client.GET("/api/members");
```

The client is a typed [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/)
instance: paths, methods, request bodies, and response shapes are all checked
against `schema.d.ts`. openapi-fetch never throws on HTTP errors — always
handle `{ data, error }`.

UI call sites consume `@myapp/contracts` only; feature code never imports
`apps/api/src/*` or generated internals directly.

## Manual artifact generation

For non-Taskfile flows:

```bash
pnpm exec rivet-reflect-ts --entry ./apps/api/src/contracts.ts --out ./contract.json
pnpm exec rivet-ts rivet -- --from ./contract.json --output ./generated
pnpm exec rivet-ts generate --generated-root ./generated
```

## Next steps

- Read [Sample App](/guides/sample-app)
- Read [Vite Plugin](/guides/vite-plugin)
- Follow the [5 minute tutorial](/guides/tutorial)
- Read [Local Now, Server Later](/guides/local-now-server-later)
- Read [OpenAPI and Generated Clients](/guides/openapi-and-validators)
- Read [.NET Handoff](/guides/dotnet-handoff)
