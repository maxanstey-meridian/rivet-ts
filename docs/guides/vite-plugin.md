# Vite Plugin

The Vite plugin is the primary browser-local workflow.

## What it does

`rivet-ts/vite` manages generated local artifacts for a scaffolded API package.

Given:

- a contract entrypoint
- a scaffolded API package
- a Hono app entry

the plugin:

- reflects the contract to `generated/*.contract.json`
- runs downstream Rivet to generate `generated/rivet/*`
- generates `src/local-rivet.ts`
- aliases `@api` to the API package root
- watches contract changes during `vite dev` and regenerates those artifacts

It does not:

- scaffold handlers
- create new routes in `src/api.ts`
- create handler files for new endpoints
- guarantee the authored API implementation matches the contract

## Recommended structure

```text
myapp/
├── package.json
├── vite.config.ts
├── packages/
│   └── api/
│       ├── contracts.ts
│       ├── src/
│       │   ├── api.ts
│       │   ├── contract.ts
│       │   ├── handlers/
│       │   └── local-rivet.ts
│       └── generated/
└── ui/
    ├── index.html
    └── src/main.ts
```

`packages/api` is scaffolded once. `ui/` is the Vite app root.

## Usage

```ts
import { defineConfig } from "vite";
import { rivetTs } from "rivet-ts/vite";

export default defineConfig({
  root: "./ui",
  plugins: [
    rivetTs({
      contract: "./packages/api/contracts.ts",
      apiRoot: "./packages/api",
      app: "./packages/api/src/api.ts",
      rivet: {
        version: "0.33.0",
      },
    }),
  ],
});
```

## Options

| Option | Description |
| --- | --- |
| `contract` | Contract entrypoint path |
| `apiRoot` | Root of the scaffolded API package |
| `app` | Hono app entry used by generated `src/local-rivet.ts` |
| `tsconfig` | Optional TypeScript project file |
| `rivet.version` | Pinned downstream Rivet version |
| `rivet.autoInstall` | Auto-download the Rivet binary when missing |
| `rivet.binaryPath` | Use an explicit Rivet binary instead of auto-install |

## UI imports

```ts
import { members } from "@api/generated/rivet/client/index.js";
import { configureLocalRivet } from "@api/src/local-rivet.js";

configureLocalRivet();
```

During `vite dev`, contract changes regenerate the local client/runtime artifacts and Vite reloads the UI with the updated client surface.

## Contract changes

When a contract file changes, the plugin regenerates:

- `generated/*.contract.json`
- `generated/rivet/*`
- `src/local-rivet.ts`

The plugin does not add handlers or route registrations for new endpoints. If a new endpoint is added to the contract, the generated client updates immediately, but local calls will still fail until the handler is implemented and mounted.
