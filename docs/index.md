---
layout: home
hero:
  name: rivet-ts
  text: TypeScript contracts to working APIs
  tagline: Write a contract, scaffold a workspace, point the UI at the typed client, and regenerate artifacts with one command.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/maxanstey-meridian/rivet-ts
features:
  - icon: "🧱"
    title: Contract first
    details: Write one TypeScript contract that captures routes, inputs, outputs, status codes, errors, examples, and security metadata.
  - icon: "⚡"
    title: Scaffold the workspace
    details: Generate a runnable pnpm workspace — Hono API under `apps/api`, Nuxt SPA under `apps/ui`, typed client package under `packages/contracts`.
  - icon: "📦"
    title: OpenAPI 3.1 as the public artifact
    details: The Rivet binary emits openapi.json from the reflected contract; openapi-typescript and openapi-fetch derive the typed client from the spec.
  - icon: "🚀"
    title: Promote later
    details: The API runs in-browser during dev via in-process dispatch, becomes a real server with one task, and the contract story carries over to .NET.
---

<div class="vp-doc" style="max-width: 860px; margin: 0 auto; padding: 0 1.5rem 2rem;">

## Overview

1. write a TypeScript contract (or let `scaffold` give you a worked example)
2. scaffold the workspace once
3. run `task install && task dev`
4. consume the typed client from `apps/ui/app/app.vue`
5. run `task generate` after contract changes
6. promote to a real server (`task api:run`) when the browser runtime stops being enough

## Contract shape

```ts
import type { Contract, Endpoint } from "rivet-ts";

export interface UserDto {
  id: string;
  name: string;
  email: string;
}

export interface GetUserParams {
  id: string;
}

export interface UsersContract extends Contract<"UsersContract"> {
  GetUser: Endpoint<{
    method: "GET";
    route: "/users/{id}";
    params: GetUserParams;
    response: UserDto;
  }>;
}
```

Scaffold the app:

```bash
pnpm exec rivet-ts scaffold-mock --entry ./contracts.ts --out ./myapp
cd ./myapp
task install
task dev
```

Then use the typed client (an `openapi-fetch` instance checked against the generated `schema.d.ts`):

```ts
import { client } from "@myapp/contracts";

const { data, error } = await client.GET("/users/{id}", {
  params: { path: { id: "usr_123" } },
});
```

`scaffold-mock` emits the workspace with bootstrap artifacts already in place. After contract changes, `task generate` re-runs the pipeline: contract entry → `api.contract.json` (internal IR) → `openapi.json` (Rivet binary) → `schema.d.ts` (openapi-typescript).

## Pages

- [Getting Started](/getting-started)
- [Hono](/guides/hono)
- [Vite Plugin](/guides/vite-plugin)
- [Zero to API in 5 Minutes](/guides/tutorial)
- [Local Now, Server Later](/guides/local-now-server-later)
- [.NET Handoff](/guides/dotnet-handoff)

</div>
