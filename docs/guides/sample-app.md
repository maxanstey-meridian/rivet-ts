# Sample App

[`samples/myapp`](https://github.com/maxanstey-meridian/rivet-ts/tree/runtime/samples/myapp) is the reference browser-local app shape.

It was produced by:

1. writing a TypeScript contract
2. running `rivet-ts scaffold-mock --entry ./contracts.ts --out ./myapp`
3. generating the local contract/client artifacts with the API `generate` script or the Vite plugin
4. opening `ui/src/main.ts` and continuing from there

The committed sample keeps the scaffolded authored shape. Generated artifacts under `packages/api/generated` and `packages/client/generated` are produced locally by `pnpm --dir packages/api run generate` or during Vite dev/build.

## Structure

```text
samples/myapp/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── .dependency-cruiser.cjs
├── vite.config.ts
├── packages/
│   ├── api/
│   │   ├── generated/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   └── client/
│       ├── generated/
│       ├── tsconfig.json
│       └── package.json
└── ui/
    ├── index.html
    ├── rivet-local.ts
    └── src/main.ts
```

## What is scaffolded once

- root `package.json`
- root `pnpm-workspace.yaml`
- root `tsconfig.json`
- root `.dependency-cruiser.cjs`
- root `vite.config.ts`
- `ui/index.html`
- `ui/rivet-local.ts`
- `ui/src/main.ts`
- `packages/api/src/app.ts`
- `packages/api/src/app/composition.ts`
- `packages/api/src/app/contract.ts`
- `packages/api/src/app/local.ts`
- `packages/api/src/app/map-contract-error.ts`
- `packages/api/package.json`
- `packages/api/tsconfig.json`
- `packages/client/package.json`
- `packages/client/tsconfig.json`
- module skeletons under `packages/api/src/modules/*`
- scaffolded handler and use-case source files under each module
- common module placeholders
- copied contract source under `packages/api/src/app`

## What the Vite plugin keeps generated

- `packages/api/generated/*.contract.json`
- `packages/client/generated/rivet/*`
- `packages/client/generated/index.ts`

During `vite dev`, contract changes regenerate those artifacts and Vite reloads the UI with the updated client surface.

## What stays authored

- `packages/api/src/app/contracts.ts`
- any copied sibling contract source files under `packages/api/src/app`
- `packages/api/src/modules/*`
- route registration in `packages/api/src/app.ts`
- `ui/src/main.ts`
- any other UI code

If a new endpoint is added to the contract, the generated client updates immediately. The scaffolded API can then fail during route registration/import until the selected contract group has exactly one handler for each endpoint and no unused handlers.
