---
layout: home
hero:
  name: rivet-ts
  text: TypeScript contracts to working APIs
  tagline: Write a contract, scaffold an app, point the UI at the generated client, and let Vite keep local artifacts up to date.
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
    title: Scaffold the full app
    details: Generate a runnable root app with `ui/`, `packages/api`, plain async handlers, and local transport wiring already in place.
  - icon: "📦"
    title: Plugin-managed local artifacts
    details: Use the Vite plugin to keep the reflected contract JSON plus generated client/runtime artifacts updated as contracts change during dev and build.
  - icon: "🚀"
    title: Promote later
    details: Keep the contract and client shape stable while moving from browser-local Hono to Bun, then to .NET.
---

<div class="vp-doc" style="max-width: 860px; margin: 0 auto; padding: 0 1.5rem 2rem;">

## Overview

1. write a TypeScript contract
2. scaffold the full app once
3. open `ui/src/main.ts`
4. run Vite
5. promote to a real server when the browser runtime stops being enough

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
pnpm install
pnpm --dir packages/api run generate
```

Then use the generated client from `ui/src/main.ts`:

```ts
import { users } from "@myapp/client";
import { configureLocalRivet } from "../rivet-local";

configureLocalRivet();

const user = await users.getUser({ params: { id: "usr_123" } });
console.log(user.name);
```

`scaffold-mock` creates the project shape. `pnpm --dir packages/api run generate` creates the initial generated contract/client artifacts, including `packages/client/generated/index.ts` via `rivet-ts`. After that, the scaffolded Vite plugin keeps them current during `vite dev`.

## Pages

- [Getting Started](/getting-started)
- [Hono](/guides/hono)
- [Vite Plugin](/guides/vite-plugin)
- [Sample App](/guides/sample-app)
- [Zero to API in 5 Minutes](/guides/tutorial)
- [Local Now, Bun Later](/guides/local-now-server-later)
- [.NET Handoff](/guides/dotnet-handoff)

</div>
