# rivet-ts

**Write a contract. Generate the spec. Consume it typed.**

Your API contract is a deliberately narrow, type-only TypeScript DSL: no
decorators, no runtime registration, and nothing for the contract module to do
at runtime. `rivet-ts` lowers it to Rivet contract JSON; the downloaded
[Rivet](https://github.com/maxanstey-meridian/rivet) binary is the sole OpenAPI
3.1 emitter; `openapi-typescript` then generates client types for
`openapi-fetch`.

## Prerequisites

- Node.js 20.19 or later (CI runs Node 24).
- pnpm 10 or later. Scaffolded workspaces pin pnpm 10.24.0 in `packageManager`.
- [go-task](https://taskfile.dev/installation/) for the `task` commands of
  scaffolded workspaces.
- Network access the first time Rivet runs: the binary is downloaded from
  GitHub Releases, then cached.
- Optional: [Plumb](https://github.com/maxanstey-meridian/plumb#requirements) for the scaffolded `task plumb` doctrine check.

## Install

```bash
pnpm add openapi-fetch
pnpm add -D @maxanstey-meridian/rivet-ts typescript
```

The package installs the `rivet-ts` command. `openapi-fetch` is the client the
generated types are for, and `typescript` type-checks your code against them.
pnpm may warn that `openapi-typescript` (used by `rivet-ts generate`) wants
`typescript@^5`; it runs on the TypeScript 6 that rivet-ts brings, so the
warning is harmless.

## Write a contract

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

`Contract` and `Endpoint` are type-only — the reflector reads them with the
TypeScript compiler API. Your contract never exists at runtime.

## Generate

```bash
pnpm exec rivet-ts --entry src/contracts.ts --out generated/api.contract.json
pnpm exec rivet-ts rivet -- --from generated/api.contract.json --output ./generated
pnpm exec rivet-ts generate --generated-root ./generated
```

That pipeline has explicit ownership:

1. `rivet-ts` writes `api.contract.json`.
2. Rivet writes `openapi.json`.
3. `rivet-ts generate` writes `schema.d.ts`.

rivet-ts pins Rivet `0.45.0` by default. On macOS arm64/x64, Linux x64, and
Windows x64, the binary is downloaded from GitHub Releases and cached
automatically; it does not need to be on `PATH`. The first run prints
`Downloading Rivet v0.45.0 for <platform>...`; the cache is
`~/Library/Caches/rivet-ts` on macOS (`$XDG_CACHE_HOME/rivet-ts` or
`~/.cache/rivet-ts` on Linux, `%LOCALAPPDATA%\rivet-ts` on Windows). Set `RIVET_VERSION` (honoured
by both the CLI passthrough and the Vite plugin), or use the [Vite plugin options](https://maxanstey-meridian.github.io/rivet-ts/guides/vite-plugin)
to select another version or binary.

## Consume

The snippet assumes an ES module project (`"type": "module"` in
`package.json`), which top-level `await` needs.

```ts
import createClient from "openapi-fetch";
import type { paths } from "./generated/schema";

const api = createClient<paths>({ baseUrl: "https://api.example.com" });

// Paths, methods, bodies, and per-status responses all inferred.
const { data, error } = await api.POST("/api/members", {
  body: { email: "ada@example.com" },
});
```

`pnpm exec tsc --noEmit consume.ts` type-checks it (with the snippet saved as
`consume.ts`).

The package also provides:

- [`@maxanstey-meridian/rivet-ts/vite`](https://maxanstey-meridian.github.io/rivet-ts/guides/vite-plugin),
  which regenerates contract JSON, `openapi.json`, and `schema.d.ts` when the
  entry or its local imports change.
- [`@maxanstey-meridian/rivet-ts/hono`](https://maxanstey-meridian.github.io/rivet-ts/guides/hono),
  which registers typed handlers against lowered contract JSON.
- [`scaffold` and `scaffold-mock`](https://maxanstey-meridian.github.io/rivet-ts/getting-started),
  which emit the Hono + Nuxt + contracts workspace or derive one from an
  existing contract.

See the [CLI reference](https://maxanstey-meridian.github.io/rivet-ts/reference/cli)
for all commands, flags, exports, and artifact ownership.

## Documentation

[Getting Started](https://maxanstey-meridian.github.io/rivet-ts/getting-started) ·
[Tutorial](https://maxanstey-meridian.github.io/rivet-ts/guides/tutorial) ·
[Hono Runtime](https://maxanstey-meridian.github.io/rivet-ts/guides/hono) ·
[CLI](https://maxanstey-meridian.github.io/rivet-ts/reference/cli) ·
[Supported Shapes](https://maxanstey-meridian.github.io/rivet-ts/reference/supported) ·
[.NET Handoff](https://maxanstey-meridian.github.io/rivet-ts/guides/dotnet-handoff)

## Development

```bash
pnpm install
pnpm lint           # oxlint
pnpm check          # tsc --noEmit
pnpm test           # build then run tests (vitest)
```

The .NET interoperability suite runs every lowerable fixture through the pinned
Rivet release and checks the vendored contract schema against it, so `pnpm test`
needs network access (the binary is downloaded once, then cached). The Plumb
legs run when `PLUMB` or `PATH` provides plumb and are reported as skipped
otherwise. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
