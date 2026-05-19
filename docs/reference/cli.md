# CLI

`rivet-ts` currently exposes two package binaries:

- `rivet-reflect-ts`
- `rivet-ts`

The browser-local Vite workflow also exposes a plugin entry:

```ts
import { rivetTs } from "rivet-ts/vite";
```

The public package subpaths are:

- `rivet-ts`
- `rivet-ts/vite`
- `rivet-ts/hono`
- `rivet-ts/local`
- `rivet-ts/package.json`

## `rivet-reflect-ts`

Reflect a TypeScript contract entrypoint into Rivet contract JSON.

```bash
rivet-reflect-ts --entry <path> [--out <file>]
```

Example:

```bash
pnpm exec rivet-reflect-ts --entry ./contracts.ts --out ./contract.json
```

If `--out` is omitted, JSON is written to stdout.

## `rivet-ts scaffold-mock`

Scaffold a working Hono plus Vite mock app from a TypeScript contract.

```bash
rivet-ts scaffold-mock --entry <file> --out <dir> [--name <project-name>] [--tsconfig <file>]
```

Example:

```bash
pnpm exec rivet-ts scaffold-mock --entry ./contracts.ts --out ./myapp
cd ./myapp
pnpm install
pnpm --dir packages/api run generate
```

`scaffold-mock` creates the project shape and authored source files. It does not itself produce `packages/api/generated/*`; that comes from the API package `generate` step.

Options:

- `--entry`: TypeScript contract entrypoint
- `--out`: output directory for the scaffolded app
- `--name`: optional package name for the scaffold
- `--tsconfig`: optional explicit TypeScript project file

## `rivet-ts generate`

Emit the app-facing generated client package entrypoint after downstream Rivet has generated `rivet/*`.

```bash
rivet-ts generate --generated-root <dir>
```

Example:

```bash
pnpm exec rivet-ts generate --generated-root ./packages/client/generated
```

This writes `<generated-root>/index.ts`. The entrypoint imports each generated client module from `rivet/client/*.ts`, exports those modules as camel-cased namespaces, re-exports `RivetError`, `configureRivet`, `rivetFetch`, their public runtime types, and conditionally re-exports generated schemas, validators, and common types when the corresponding downstream files exist.

## Diagnostics

Diagnostics are written to stderr.

Behavioral rules:

- unsupported constructs produce explicit errors or warnings
- the reflector does not silently widen complex unsupported TS types into fake JSON shapes
- scaffold generation prefers visible TODO stubs over lying handlers

## Working directory note

When using `pnpm exec` inside this repo, command resolution may still run with the workspace root as `cwd`. In practice, the safest form is:

```bash
cd /path/to/rivet-ts
pnpm exec rivet-ts scaffold-mock --entry poc1/contracts.ts --out poc1
```

Or use absolute/fully-qualified relative paths when running from nested directories.
