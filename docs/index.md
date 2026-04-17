---
layout: home
hero:
  name: rivet-ts
  text: TypeScript contracts to working APIs
  tagline: Write a contract, scaffold an API package, point the UI at @api, and let Vite keep local artifacts up to date.
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
    title: Scaffold the API package
    details: Generate a runnable Hono API package with plain async handlers and local transport wiring.
  - icon: "📦"
    title: Plugin-managed local artifacts
    details: Use the Vite plugin to keep the reflected contract, generated client, and local-rivet glue updated under the API package.
  - icon: "🚀"
    title: Promote later
    details: Keep the contract and client shape stable while moving from browser-local Hono to Bun, then to .NET.
---

<div class="vp-doc" style="max-width: 860px; margin: 0 auto; padding: 0 1.5rem 2rem;">

## Overview

1. write a TypeScript contract
2. scaffold the API package once
3. point the UI at `@api`
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

Scaffold the API package once:

```bash
pnpm exec rivet-ts scaffold-mock --entry ./packages/api/contracts.ts --out ./packages/api
```

Add the Vite plugin:

```ts
import { defineConfig } from "vite";
import { rivetTs } from "rivet-ts/vite";

export default defineConfig({
  root: "./ui",
  plugins: [
    rivetTs({
      contract: "./packages/api/contracts.ts",
      apiRoot: "./packages/api",
      app: "./packages/api/src/api.ts",
      rivet: {
        version: "0.33.0",
      },
    }),
  ],
});
```

Use the generated client from the UI:

```ts
import { users } from "@api/generated/rivet/client/index.js";
import { configureLocalRivet } from "@api/src/local-rivet.js";

configureLocalRivet();

const user = await users.getUser("usr_123");
console.log(user.name);
```

The plugin keeps the local client/runtime artifacts updated under `packages/api`.

## Pages

- [Getting Started](/getting-started)
- [Vite Plugin](/guides/vite-plugin)
- [Zero to API in 5 Minutes](/guides/tutorial)
- [Local Now, Bun Later](/guides/local-now-server-later)
- [.NET Handoff](/guides/dotnet-handoff)

</div>
