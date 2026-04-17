# CLI

`rivet-ts` currently exposes two CLI entrypoints.

The browser-local Vite workflow also exposes a plugin entry:

```ts
import { rivetTs } from "rivet-ts/vite";
```

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
```

Options:

- `--entry`: TypeScript contract entrypoint
- `--out`: output directory for the scaffolded app
- `--name`: optional package name for the scaffold
- `--tsconfig`: optional explicit TypeScript project file

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
