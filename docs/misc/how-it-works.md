# How It Works

`rivet-ts` is a TypeScript contract authoring and scaffolding pipeline.

## 1. Author in TypeScript

You write a contract using:

- `Contract<"...">`
- `Endpoint<{ ... }>`
- normal exported TypeScript DTOs and example values

That contract is the source of truth for:

- routes
- HTTP methods
- inputs and outputs
- status codes
- errors
- examples
- security metadata

## 2. Reflect to contract JSON

`rivet-ts --entry <path>` reads the TypeScript contract graph with the compiler API and lowers it into a contract JSON document. That document is an internal IR — the bridge between the TS authoring world, the scaffold workflow, the Hono runtime's route registration, and the Rivet binary. OpenAPI 3.1 is the public format; the IR is plumbing.

## 3. Scaffold a workspace

`rivet-ts scaffold` (worked example) and `rivet-ts scaffold-mock` (from your contract) emit the same pnpm workspace:

- a Hono API under `apps/api` with one module per contract, handlers typed via `RivetHandler<...>`, and user-owned Zod schemas beside each module's routes that reject invalid request bodies with a structured 422 at the route edge
- a Nuxt SPA under `apps/ui` with in-browser transport wired once in `app/plugins/rivet.client.ts`
- a contracts package: read-only `generated/{openapi.json, schema.d.ts}` plus a hand-owned `src/index.ts` client facade
- a Taskfile (`install` / `dev` / `generate` / `api:run` / `api:test` / `plumb`)

## 4. Generate downstream artifacts

The version-pinned Rivet binary consumes the contract JSON and emits one artifact: an OpenAPI 3.1 document (`openapi.json`). Everything downstream of the spec comes from the OpenAPI ecosystem: `rivet-ts generate` runs `openapi-typescript` over it to produce `schema.d.ts`, and the scaffold-time facade wraps `openapi-fetch` with those types. Inbound request binding (structured 400s) is the Hono adapter's job on the server; body-shape validation (structured 422s) is the scaffolded, user-owned Zod schemas' job; the client is types-only with no runtime validation.

## 5. Promote transport later

Locally, the typed client talks to Hono in-process via `app.request`. Later, the same app runs as a real server (`task api:run`) and the client switches to:

```ts
configureRivet({ baseUrl: "https://api.example.com" });
```

Same contract, same client surface — only the transport configuration changes.
