<p align="center">
  <h1 align="center">rivet-ts</h1>
  <p align="center">
    <a href="https://www.npmjs.com/package/@maxanstey-meridian/rivet-ts"><img src="https://img.shields.io/npm/v/@maxanstey-meridian/rivet-ts?label=%40maxanstey-meridian%2Frivet-ts" alt="npm" /></a>
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="License" />
  </p>
</p>

**Your TypeScript is the contract.** rivet-ts reads a type-only TypeScript contract with
the compiler API and lowers it to Rivet contract JSON. The
[Rivet](https://github.com/maxanstey-meridian/rivet) binary then emits an OpenAPI 3.1 spec
from it, and the OpenAPI ecosystem does the rest: `openapi-typescript` types an
`openapi-fetch` client, and the Hono runtime serves handlers typed against the same contract.

The contract is types and nothing else. There are no decorators, no router object and no
runtime registration, so the contract module has no work to do at runtime. Rivet gives a .NET
server this DX; rivet-ts is the same pipeline when your server is TypeScript. Both read the same
contract JSON, so the backend can move to .NET later without the client noticing.

## Prerequisites

- Node.js 20.19+ or 22.12+. Scaffolded workspaces use Nuxt, which needs Node.js 22.19+ or 24.11+.
- pnpm 10 or later, and [go-task](https://taskfile.dev/installation/) for scaffolded workspaces.
- Network access the first time Rivet runs. The binary is downloaded from GitHub Releases,
  checked against its published digest, then cached. It never needs to be on `PATH`.

## Install

```bash
pnpm add openapi-fetch
pnpm add -D @maxanstey-meridian/rivet-ts typescript
```

pnpm may warn that `openapi-typescript` wants `typescript@^5`. It runs on the TypeScript 6
rivet-ts brings, so the warning is harmless.

## Three steps in

### 1. Write the contract

```ts
import type { Contract, Endpoint } from "@maxanstey-meridian/rivet-ts";

export interface MemberDto {
  id: string;
  email: string;
  role: "admin" | "member";
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

Routes, inputs, outputs, statuses, errors, examples and security sit in one place, as types.
`Brand<string, "Email">` and `Format<string, "uuid">` carry meaning the wire type can't.

### 2. Generate the spec

```bash
pnpm exec rivet-ts --entry src/contracts.ts --out generated/api.contract.json
pnpm exec rivet-ts rivet -- --from generated/api.contract.json --output ./generated
pnpm exec rivet-ts generate --generated-root ./generated
```

Each artifact has one owner. rivet-ts writes `api.contract.json`, Rivet writes `openapi.json`,
and `rivet-ts generate` writes `schema.d.ts`. rivet-ts pins Rivet `0.45.1`; set
`RIVET_VERSION` to use another.

### 3. Consume it typed

```ts
import createClient from "openapi-fetch";
import type { paths } from "./generated/schema";

const api = createClient<paths>({ baseUrl: "https://api.example.com" });

// Path, body and per-status responses all inferred.
const { data, error } = await api.POST("/api/members", {
  body: { email: "ada@example.com" },
});
```

## Serve it

Add `hono` and register handlers against the contract JSON:

```ts
import { Hono } from "hono";
import { registerRivetHonoRoutes } from "@maxanstey-meridian/rivet-ts/hono";
import contract from "../generated/api.contract.json" with { type: "json" };
import type { MembersContract } from "./contracts.js";

export const app = new Hono();

registerRivetHonoRoutes<MembersContract>(app, contract, {
  handlers: {
    List: async () => [],
    // `body` is a CreateMemberRequest, and the result must be a MemberDto.
    Create: async ({ body }) => ({ id: "mem_1", email: body.email, role: "member" }),
  },
});
```

`POST /api/members` answers `201` with the new member. Change `MemberDto` and the spec, the
client and every handler change with it: a handler that returns the old shape stops
compiling. A missing handler, an unused one or a duplicate route fails at registration, not
on the first request.

## Also in the box

- [Scaffolding](https://maxanstey-meridian.github.io/rivet-ts/getting-started): `scaffold`
  emits a Hono API, a Nuxt SPA and a typed client package as one pnpm workspace;
  `scaffold-mock` derives that workspace from your contract, with a typed mock handler for
  every endpoint
- [Local now, server later](https://maxanstey-meridian.github.io/rivet-ts/guides/local-now-server-later):
  the scaffolded API runs inside the browser during development, then becomes a real server
  with one task
- [The Vite plugin](https://maxanstey-meridian.github.io/rivet-ts/guides/vite-plugin):
  regenerates contract JSON, `openapi.json` and `schema.d.ts` when the contract or its local
  imports change
- [.NET handoff](https://maxanstey-meridian.github.io/rivet-ts/guides/dotnet-handoff): move the
  backend to Rivet on .NET and keep every client call site
- Stable diagnostic codes on every lowering error and scaffold warning, naming the file it
  concerns, so you can grep for them
- [Plumb](https://github.com/maxanstey-meridian/plumb#requirements) checks: scaffolded
  workspaces start with zero Meridian doctrine findings, and `task plumb` keeps them there
- `@maxanstey-meridian/rivet-ts/tooling`: the lowering pipeline as a library, for build tools

## Documentation

[Getting Started](https://maxanstey-meridian.github.io/rivet-ts/getting-started) ·
[Tutorial](https://maxanstey-meridian.github.io/rivet-ts/guides/tutorial) ·
[Hono Runtime](https://maxanstey-meridian.github.io/rivet-ts/guides/hono) ·
[CLI Reference](https://maxanstey-meridian.github.io/rivet-ts/reference/cli) ·
[Supported Shapes](https://maxanstey-meridian.github.io/rivet-ts/reference/supported) ·
[Unsupported Shapes](https://maxanstey-meridian.github.io/rivet-ts/reference/unsupported)
(what rivet-ts deliberately doesn't lower)

Contributors should read [CONTRIBUTING.md](CONTRIBUTING.md). `pnpm test` builds first and needs
network access once, for the pinned Rivet release.

## License

[MIT](LICENSE)
