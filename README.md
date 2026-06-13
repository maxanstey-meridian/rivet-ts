# rivet-ts

**Write a contract. Generate the spec. Consume it typed.**

Your API contract is plain TypeScript types — no decorators, no runtime
registration, nothing to import at runtime. rivet-ts reflects it into an
OpenAPI 3.1 spec and a fully typed client. The TypeScript-first sibling of
[Rivet](https://github.com/maxanstey-meridian/rivet) (.NET).

```bash
pnpm add -D github:maxanstey-meridian/rivet-ts#v0.11.1
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
rivet-ts --entry src/contracts.ts --out generated/api.contract.json
rivet-ts rivet -- --from generated/api.contract.json --output ./generated
rivet-ts generate --generated-root ./generated
```

reflect → OpenAPI 3.1 → `schema.d.ts`. The OpenAPI emitter binary is
downloaded and cached automatically; nothing needs to be on `PATH`.

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

There's also a [Vite plugin](https://maxanstey-meridian.github.io/rivet-ts/guides/vite-plugin)
that regenerates everything on contract changes during dev. Serving the
contract with Hono, and scaffolding a full workspace around it, live in the
[docs](https://maxanstey-meridian.github.io/rivet-ts/guides/hono).

## Documentation

[Getting Started](https://maxanstey-meridian.github.io/rivet-ts/getting-started) ·
[Tutorial](https://maxanstey-meridian.github.io/rivet-ts/guides/tutorial) ·
[Hono Runtime](https://maxanstey-meridian.github.io/rivet-ts/guides/hono) ·
[CLI](https://maxanstey-meridian.github.io/rivet-ts/reference/cli) ·
[Supported Shapes](https://maxanstey-meridian.github.io/rivet-ts/reference/supported) ·
[.NET Handoff](https://maxanstey-meridian.github.io/rivet-ts/guides/dotnet-handoff)

## Development

```bash
pnpm test          # build then run tests (vitest)
pnpm run lint      # oxlint
pnpm run check     # tsc --noEmit
```

## License

MIT
