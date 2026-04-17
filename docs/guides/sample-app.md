# Sample App

[`samples/myapp`](https://github.com/maxanstey-meridian/rivet-ts/tree/runtime/samples/myapp) is the reference browser-local app shape.

It was produced by:

1. writing a TypeScript contract in `packages/api/contracts.ts`
2. scaffolding `packages/api` with `rivet-ts scaffold-mock`
3. adding the Vite plugin at the app root
4. pointing the UI at `@api`

## Structure

```text
samples/myapp/
├── package.json
├── vite.config.ts
├── packages/
│   └── api/
│       ├── contracts.ts
│       ├── generated/
│       ├── package.json
│       └── src/
│           ├── api.ts
│           ├── contract.ts
│           ├── handlers/
│           └── local-rivet.ts
└── ui/
    ├── index.html
    └── src/main.ts
```

## What is scaffolded once

- `packages/api/src/api.ts`
- `packages/api/src/handlers/*`
- `packages/api/src/contract.ts`
- `packages/api/package.json`
- the initial `ui`-facing local app shape

## What the Vite plugin keeps generated

- `packages/api/generated/*.contract.json`
- `packages/api/generated/rivet/*`
- `packages/api/src/local-rivet.ts`

During `vite dev`, contract changes regenerate those artifacts and Vite reloads the UI with the updated client surface.

## What stays authored

- `packages/api/contracts.ts`
- `packages/api/src/handlers/*`
- route registration in `packages/api/src/api.ts`
- `ui/src/main.ts`
- any other UI code

If a new endpoint is added to the contract, the generated client updates immediately. Local calls still fail until the handler is implemented and mounted.
