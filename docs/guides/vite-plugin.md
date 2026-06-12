# Vite Plugin

`rivet-ts/vite` regenerates the contract artifacts on dev-server start, on build, and whenever the contract entry (or one of its local imports) changes.

The scaffolded workspace does not use it — its `task generate` runs the same pipeline as explicit CLI steps. The plugin exists for Vite-based projects that want regeneration wired into the dev loop.

## What it does

Given a contract entrypoint, each regeneration:

- reflects the contract to contract JSON (the internal IR)
- runs the Rivet binary (`--from <contract.json> --output <clientOutDir>`), which writes `<clientOutDir>/openapi.json` and nothing else
- runs `openapi-typescript` over that spec to emit `<clientOutDir>/schema.d.ts`

It does not:

- emit a client facade (`index.ts` is scaffold-time and hand-owned; the artifact directory holds exactly `openapi.json` + `schema.d.ts`)
- scaffold handlers or routes
- guarantee the authored API implementation matches the contract

## Usage

```ts
import { defineConfig } from "vite";
import { rivetTs } from "rivet-ts/vite";

export default defineConfig({
  plugins: [
    rivetTs({
      entry: "./apps/api/src/contracts.ts",
      apiRoot: "./apps/api",
      clientOutDir: "./packages/contracts/generated",
    }),
  ],
});
```

## Options

| Option               | Description                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `entry`              | Contract entrypoint path (`contract` is a legacy alias; one of the two is required)           |
| `apiRoot`            | Root of the API package (required)                                                            |
| `runtimeContractOut` | Contract JSON output path. Default: `<apiRoot>/generated/<kebab-cased-api-dir>.contract.json` |
| `clientOutDir`       | Artifact directory for `openapi.json` + `schema.d.ts`. Default: `<apiRoot>/generated`         |
| `tsconfig`           | Optional TypeScript project file for reflection                                               |
| `rivet.version`      | Rivet binary version to download (default `0.35.0`)                                           |
| `rivet.autoInstall`  | Auto-download the binary when missing (default `true`)                                        |
| `rivet.binaryPath`   | Use an explicit Rivet binary instead of auto-install                                          |
| `rivet.cacheDir`     | Override the auto-installed binary cache directory                                            |

Relative option paths resolve against the directory the Vite config file lives in (falling back to the resolved root), never `process.cwd()` — `vite -c myapp/vite.config.ts` from a parent directory works.

## Failure behavior

Failures are loud, and last-good artifacts survive:

- `vite build` hard-errors on reflection error diagnostics, on a binary failure, or when the binary exits 0 without writing `openapi.json`.
- The dev server logs the error, stays up, and keeps watching the entry so a fix triggers recovery.
- Before each binary run the previous `openapi.json` is moved aside; on any failure it is restored and `schema.d.ts` is left untouched. A stale or missing spec is never silently fed back into the generated types.

## Watching

The entry's local import graph is watched and re-collected after each regeneration; the entry itself stays watched even when reflection fails. Editor double-save bursts are debounced (~50 ms). A successful regeneration triggers a full browser reload so the UI picks up the new client surface.

## Binary install

The binary downloads from GitHub releases into a per-OS cache (macOS: `~/Library/Caches/rivet-ts`; Linux: `$XDG_CACHE_HOME/rivet-ts` or `~/.cache/rivet-ts`; Windows: `%LOCALAPPDATA%\rivet-ts`), verifying the release's sha256 digest when one is published and installing atomically. Supported auto-install platforms: macOS arm64/x64, Linux x64, Windows x64. Elsewhere, build the binary yourself and pass `rivet.binaryPath`.
