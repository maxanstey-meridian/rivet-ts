# Getting Started

1. install `rivet-ts`
2. write a TypeScript contract
3. scaffold the full app
4. run `pnpm install`
5. open `ui/src/main.ts` and start consuming the generated client

## 1. Install

```bash
pnpm add -D github:maxanstey-meridian/rivet-ts#v0.9.1
```

The scaffolded Vite plugin can download a pinned Rivet binary automatically when it runs. The manual API package `generate` script shells out to `rivet`, so that command expects the Rivet CLI to be available on `PATH`.

## 2. Write a contract

Create `contracts.ts`:

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

## 3. Scaffold the full app

```bash
pnpm exec rivet-ts scaffold-mock --entry ./contracts.ts --out ./myapp
cd ./myapp
pnpm install
pnpm --dir packages/api run generate
```

This creates the default browser-local app shape and then generates the initial local artifacts:

```text
myapp/
├── package.json
├── pnpm-workspace.yaml
├── vite.config.ts
├── tsconfig.json
├── .dependency-cruiser.cjs
├── packages/
│   ├── api/
│   │   ├── generated/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── app.ts
│   │       ├── app/
│   │       └── modules/
│   └── client/
│       ├── generated/
│       ├── tsconfig.json
│       └── package.json
└── ui/
    ├── index.html
    ├── rivet-local.ts
    └── src/main.ts
```

The scaffold already includes:

- the API package under `packages/api`
- the root Vite config with `rivet-ts/vite`
- the `ui/` root
- an initial `ui/src/main.ts` that configures local transport and consumes the generated client when possible

Important:

- `scaffold-mock` creates the project shape and authored handlers
- `pnpm --dir packages/api run generate` produces `packages/api/generated/api.contract.json`, `packages/client/generated/openapi.json`, `packages/client/generated/schema.d.ts`, and `packages/client/generated/index.ts`; it uses the `rivet` command from `PATH`
- once those initial artifacts exist, `vite dev` keeps them current

The important boundary is that normal UI call sites consume `@myapp/client`, and local browser transport is wired once in `ui/rivet-local.ts` via `@myapp/api/local`. Feature UI code does not import `packages/api/src/*` or generated internals directly.

## 4. Start consuming from the UI

Open `ui/src/main.ts`.

Typical usage looks like this:

```ts
import { client } from "@myapp/client";
import { configureLocalRivet } from "../rivet-local";

configureLocalRivet();

const all = await client.GET("/api/members");
console.log(all.data);
```

The client is a typed [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) instance: paths, methods, request bodies, and response shapes are all checked against `schema.d.ts`, which is generated from the emitted OpenAPI spec.

That means the client code is written against the generated client surface, not against its hosting mode. Later, you can swap `configureLocalRivet()` for `configureRivet({ baseUrl })` without rewriting the generated client calls.

During `vite dev`, contract changes regenerate:

- `packages/api/generated/*.contract.json`
- `packages/client/generated/openapi.json`
- `packages/client/generated/schema.d.ts`
- `packages/client/generated/index.ts`

Vite then reloads the UI against the updated client surface.

## 5. Run the app

```bash
pnpm run dev
```

## Manual artifact generation

For OpenAPI, validators, JSON Schema, or non-plugin/manual flows:

```bash
dotnet tool install --global dotnet-rivet
pnpm exec rivet-reflect-ts --entry ./packages/api/src/app/contracts.ts --out ./contract.json
dotnet rivet --from ./contract.json --output ./generated --openapi ./openapi.json
```

## Next steps

- Read [Sample App](/guides/sample-app)
- Read [Vite Plugin](/guides/vite-plugin)
- Follow the [5 minute tutorial](/guides/tutorial)
- Read [Local Now, Bun Later](/guides/local-now-server-later)
- Read [OpenAPI and Validators](/guides/openapi-and-validators)
- Read [.NET Handoff](/guides/dotnet-handoff)
