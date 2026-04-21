# Vite Plugin

The Vite plugin is the primary browser-local workflow.

`scaffold-mock` now emits the root Vite config for this by default. This page describes the generated integration and the lower-level plugin behavior.

## What it does

`rivet-ts/vite` manages generated local artifacts for a scaffolded API package.

Given:

- a contract entrypoint
- a scaffolded API package
- a Hono app entry

the plugin:

- reflects the contract to `generated/*.contract.json`
- runs downstream Rivet to generate `packages/client/generated/rivet/*`
- emits `packages/client/generated/index.ts`
- watches contract changes during `vite dev` and regenerates those artifacts

It does not:

- scaffold handlers
- create new routes in `packages/api/src/app.ts`
- create handler files for new endpoints
- guarantee the authored API implementation matches the contract

## Recommended structure

```text
myapp/
├── package.json
├── vite.config.ts
├── packages/
│   ├── api/
│   │   ├── generated/
│   │   └── src/
│   └── client/
│       └── generated/
└── ui/
    ├── index.html
    ├── rivet-local.ts
    └── src/main.ts
```

`packages/api` is scaffolded once. `ui/` is the Vite app root. The default scaffold already emits this shape.

## Usage

```ts
import { defineConfig } from "vite";
import { rivetTs } from "rivet-ts/vite";

export default defineConfig({
  root: "./ui",
  plugins: [
    rivetTs({
      entry: "./packages/api/src/app/contracts.ts",
      apiRoot: "./packages/api",
      runtimeContractOut: "./packages/api/generated/api.contract.json",
      clientOutDir: "./packages/client/generated",
      rivet: {
        version: "0.34.0",
      },
    }),
  ],
});
```

## Options

| Option              | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `entry`             | Contract entrypoint path                             |
| `contract`          | Legacy alias for `entry`                             |
| `apiRoot`           | Root of the scaffolded API package                   |
| `tsconfig`          | Optional TypeScript project file                     |
| `rivet.version`     | Pinned downstream Rivet version                      |
| `rivet.autoInstall` | Auto-download the Rivet binary when missing          |
| `rivet.binaryPath`  | Use an explicit Rivet binary instead of auto-install |

## UI imports

```ts
import { members } from "@myapp/client";
import { configureLocalRivet } from "../rivet-local";

configureLocalRivet();
```

During `vite dev`, contract changes regenerate the local client/runtime artifacts and Vite reloads the UI with the updated client surface.

## Contract changes

When a contract file changes, the plugin regenerates:

- `generated/*.contract.json`
- `packages/client/generated/rivet/*`
- `packages/client/generated/index.ts`

The plugin does not add handlers or route registrations for new endpoints. If a new endpoint is added to the contract, the generated client updates immediately, but local calls will still fail until the handler is implemented and mounted.
