# Sample App

[`samples/myapp`](https://github.com/maxanstey-meridian/rivet-ts/tree/runtime/samples/myapp) is the reference browser-local app shape.

It was produced by:

1. writing a TypeScript contract
2. running `rivet-ts scaffold-mock --entry ./contracts.ts --out ./myapp`
3. opening `ui/src/main.ts` and continuing from there

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

- root `package.json`
- root `vite.config.ts`
- `ui/index.html`
- `ui/src/main.ts`
- `packages/api/src/api.ts`
- `packages/api/src/handlers/*`
- `packages/api/src/contract.ts`
- `packages/api/package.json`
- copied contract source under `packages/api`

## What the Vite plugin keeps generated

- `packages/api/generated/*.contract.json`
- `packages/api/generated/rivet/*`
- `packages/api/src/local-rivet.ts`

During `vite dev`, contract changes regenerate those artifacts and Vite reloads the UI with the updated client surface.

## What stays authored

- `packages/api/contracts.ts`
- any copied sibling contract source files under `packages/api`
- `packages/api/src/handlers/*`
- route registration in `packages/api/src/api.ts`
- `ui/src/main.ts`
- any other UI code

If a new endpoint is added to the contract, the generated client updates immediately. Local calls still fail until the handler is implemented and mounted.
