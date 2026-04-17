# Getting Started

1. install `rivet-ts`
2. create `packages/api` and `ui`
3. write a TypeScript contract in `packages/api`
4. scaffold the API package once
5. add the Vite plugin and import from `@api`

## 1. Install

```bash
pnpm add -D github:maxanstey-meridian/rivet-ts#v0.7
```

The browser-local flow does not require a separate `dotnet` install. The Vite plugin downloads a pinned Rivet binary automatically when it needs one.

## 2. Write a contract in `packages/api`

```ts
import type { Contract, Endpoint } from "rivet-ts";

export interface MemberDto {
  id: string;
  email: string;
  role: MemberRole;
}

export type MemberRole = "admin" | "member";

export interface CreateMemberRequest {
  email: string;
}

export interface ValidationErrorDto {
  message: string;
  fields: Record<string, string[]>;
}

export interface MembersContract extends Contract<"MembersContract"> {
  List: Endpoint<{
    method: "GET";
    route: "/api/members";
    response: MemberDto[];
    description: "List all members";
  }>;

  Create: Endpoint<{
    method: "POST";
    route: "/api/members";
    input: CreateMemberRequest;
    response: MemberDto;
    successStatus: 201;
    errors: [{ status: 422; response: ValidationErrorDto; description: "Validation failed" }];
  }>;
}
```

## 3. Scaffold the API package once

```bash
pnpm exec rivet-ts scaffold-mock --entry ./packages/api/contracts.ts --out ./packages/api
```

This creates the API package shape:

```text
packages/api/
├── contracts.ts
├── src/
│   ├── api.ts
│   ├── contract.ts
│   ├── handlers/
│   └── local-rivet.ts
├── package.json
└── generated/
```

## 4. Add the Vite plugin

At the app root:

```bash
pnpm install
```

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

The plugin:

- reflects the contract
- generates `packages/api/generated/rivet/*`
- generates `packages/api/generated/*.contract.json`
- generates `packages/api/src/local-rivet.ts`
- aliases `@api` to `packages/api`

## 5. Use `@api` from the UI

```ts
import { members } from "@api/generated/rivet/client/index.js";
import { configureLocalRivet } from "@api/src/local-rivet.js";

configureLocalRivet();

const all = await members.list();
console.log(all);
```

Run Vite:

```bash
pnpm run dev
```

The UI imports `@api`. The plugin keeps the generated local client/runtime artifacts under `packages/api` up to date.

## Manual artifact generation

For OpenAPI, validators, JSON Schema, or non-plugin/manual flows:

```bash
dotnet tool install --global dotnet-rivet
pnpm exec rivet-reflect-ts --entry ./packages/api/contracts.ts --out ./contract.json
dotnet rivet --from ./contract.json --output ./generated --openapi ./openapi.json
```

## Next steps

- Read [Vite Plugin](/guides/vite-plugin)
- Follow the [5 minute tutorial](/guides/tutorial)
- Read [Local Now, Bun Later](/guides/local-now-server-later)
- Read [OpenAPI and Validators](/guides/openapi-and-validators)
- Read [.NET Handoff](/guides/dotnet-handoff)
