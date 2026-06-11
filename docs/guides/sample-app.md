# Sample App

`samples/myapp` in this repository is a **legacy** sample: it was produced by an earlier `scaffold-mock` and keeps the pre-v2 workspace shape (root Vite app with `ui/`, `packages/api`, `packages/client`, `ui/rivet-local.ts`). It is kept for reference but no longer matches what the scaffold commands emit.

The current scaffold output looks like this instead:

```text
myapp/
├── Taskfile.yml
├── apps/
│   ├── api/          ← Hono backend (contract entry, modules, routes)
│   └── ui/           ← Nuxt SPA (ssr: false)
└── packages/contracts/
    ├── generated/    ← read-only: openapi.json + schema.d.ts
    └── src/index.ts  ← hand-owned typed client facade
```

To produce a current reference app, run either scaffold command yourself:

```bash
# Worked example module (quotes)
pnpm exec rivet-ts scaffold --out ./myapp --name myapp

# Or from your own contract
pnpm exec rivet-ts scaffold-mock --entry ./contracts.ts --out ./myapp
```

See [Getting Started](/getting-started) for the emitted shape and the dev loop, and the [5 minute tutorial](/guides/tutorial) for a walkthrough.

## What is scaffolded once (hand-owned afterwards)

- the workspace skeleton: root `package.json`, `pnpm-workspace.yaml`, `Taskfile.yml`, lint/format configs
- everything under `apps/api/src/` and `apps/ui/`
- `packages/contracts/src/index.ts` — the client facade

## What `task generate` keeps regenerated (read-only)

- `apps/api/generated/api.contract.json` — the internal IR
- `packages/contracts/generated/openapi.json` — the OpenAPI 3.1 spec from the Rivet binary
- `packages/contracts/generated/schema.d.ts` — `openapi-typescript` types

If a new endpoint is added to the contract, the generated client surface updates on the next `task generate`. The API then fails loudly at route registration until the selected contract group has exactly one handler per endpoint and no unused handlers.
