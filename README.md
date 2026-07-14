# rivet-ts

**Write a contract. Generate the spec. Consume it typed.**

Your API contract is a deliberately narrow, type-only TypeScript DSL: no
decorators, no runtime registration, and nothing for the contract module to do
at runtime. `rivet-ts` lowers it to Rivet contract JSON; the downloaded
[Rivet](https://github.com/maxanstey-meridian/rivet) binary is the sole OpenAPI
3.1 emitter; `openapi-typescript` then generates client types for
`openapi-fetch`.

## Install

`rivet-ts` currently ships from versioned Git tags, not the npm registry. The
install builds the package through its `prepare` script.

```bash
pnpm add -D github:maxanstey-meridian/rivet-ts#v0.13.0
```

## Write a contract

```ts
import type { Contract, Endpoint } from "rivet-ts";

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

`v0.13.0` pins Rivet `0.40.0` by default. On macOS arm64/x64, Linux x64, and
Windows x64, the binary is downloaded from GitHub Releases and cached
automatically; it does not need to be on `PATH`. Set `RIVET_VERSION` for the
CLI passthrough, or use the [Vite plugin options](https://maxanstey-meridian.github.io/rivet-ts/guides/vite-plugin)
to select another version or binary.

## Consume

```ts
import createClient from "openapi-fetch";
import type { paths } from "./generated/schema";

const api = createClient<paths>({ baseUrl: "https://api.example.com" });

// Paths, methods, bodies, and per-status responses all inferred.
const { data, error } = await api.POST("/api/members", {
  body: { email: "ada@example.com" },
});
```

The package also provides:

- [`rivet-ts/vite`](https://maxanstey-meridian.github.io/rivet-ts/guides/vite-plugin),
  which regenerates contract JSON, `openapi.json`, and `schema.d.ts` when the
  entry or its local imports change.
- [`rivet-ts/hono`](https://maxanstey-meridian.github.io/rivet-ts/guides/hono),
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
pnpm lint           # oxlint
pnpm check          # tsc --noEmit
pnpm test           # build then run tests (vitest)
```

The .NET interoperability and Meridian `plumb` integration legs self-skip when
their external tools are unavailable.

## License

MIT
