# CLI

The package exposes two identical binaries — `rivet-ts` and the legacy alias `rivet-reflect-ts` — plus these subpath exports:

- `rivet-ts` — authoring types, handler types, the reflection pipeline
- `rivet-ts/vite` — the Vite plugin
- `rivet-ts/hono` — the Hono server runtime
- `rivet-ts/local` — in-process dispatch helpers for the typed client
- `rivet-ts/package.json`

Usage (from `rivet-ts --help`):

```text
rivet-ts --entry <path> [--out <file>]
rivet-ts scaffold --out <dir> [--name <project-name>] [--no-api] [--force]
rivet-ts scaffold-mock --entry <file> --out <dir> [--name <project-name>] [--tsconfig <file>] [--spec <openapi.json>] [--force]
rivet-ts generate --generated-root <dir>
rivet-ts rivet [--] <args passed to the Rivet binary>
```

`--help`/`-h` prints usage; `--version` prints the package version. Unknown flags and valued flags missing their value are loud errors, never silently ignored.

## Reflect (bare form)

Reflect a TypeScript contract entry into contract JSON — the internal IR consumed by the Rivet binary and the Hono runtime.

```bash
pnpm exec rivet-ts --entry ./contracts.ts --out ./contract.json
```

- If `--out` is omitted, JSON is written to stdout.
- `--out` creates missing parent directories.
- An entry containing zero contracts produces an `ENTRY_NO_CONTRACTS` warning instead of silently emitting an empty document.
- Exit code is 1 when any error diagnostic was produced.

## `rivet-ts scaffold`

Scaffold a fresh workspace with a worked example module (`quotes`):

```bash
pnpm exec rivet-ts scaffold --out ./myapp --name myapp
```

Options:

- `--out`: output directory (required)
- `--name`: project name; defaults to the output directory's basename
- `--no-api`: emit only `apps/ui` + `packages/contracts`, for repos whose API lives elsewhere
- `--force`: scaffold into a non-empty directory (refused otherwise)

The command lowers its own example contract through the real reflection pipeline before emitting, so the bootstrap `api.contract.json` matches the emitted `contracts.ts` by construction.

## `rivet-ts scaffold-mock`

Scaffold the same workspace shape from an existing contract entry; api modules return synthesized mock values until you replace them.

```bash
pnpm exec rivet-ts scaffold-mock --entry ./contracts.ts --out ./myapp
cd ./myapp
task install
task dev
```

Options:

- `--entry`: TypeScript contract entrypoint (required)
- `--out`: output directory (required)
- `--name`: optional project name
- `--tsconfig`: optional explicit TypeScript project file for reflection
- `--spec`: optional generated `openapi.json`; its JSON Schema constraints (`minLength`/`maxLength`/`pattern`, numeric bounds, `multipleOf`, `minItems`/`maxItems`/`uniqueItems`) are chained onto the emitted Zod schemas. Without it the schemas carry shape only. Reading the file fails loudly if it is missing or not valid JSON
- `--force`: scaffold into a non-empty directory (refused otherwise)

Body-carrying endpoints get a Zod schema in `apps/api/src/modules/<module>/<module>-validation.ts` (exported from the api package as `./validation`, user-owned after emission) and a handler wrapper that rejects invalid bodies with `422 { code: "validation_failed" }`.

The entry and its local imports are copied into `apps/api/src/` preserving their relative layout. A copied file that would collide with a scaffold-emitted file (`contract.ts`, `local.ts`, `main.ts`, `app.ts`) is an error, not a silent overwrite.

## `rivet-ts generate`

Derive `schema.d.ts` from the OpenAPI spec the Rivet binary wrote:

```bash
pnpm exec rivet-ts generate --generated-root ./packages/contracts/generated
```

This reads `<generated-root>/openapi.json` and writes `<generated-root>/schema.d.ts` (openapi-typescript). It fails loudly when `openapi.json` is missing. It does **not** write a client facade — the facade is emitted once at scaffold time into `packages/contracts/src/index.ts` and is hand-owned afterwards; the generated directory holds exactly `openapi.json` + `schema.d.ts`. (A stale pre-facade `index.ts` left in the generated directory by an older scaffold is removed.)

## `rivet-ts rivet`

Resolve the cached Rivet binary — auto-installing on first use, exactly as the Vite plugin does — and pass the remaining arguments through verbatim:

```bash
pnpm exec rivet-ts rivet -- --from ./contract.json --output ./packages/contracts/generated
```

The `RIVET_VERSION` environment variable overrides the pinned default version. Scaffolded `task generate` pipelines call this instead of a bare `rivet` that is never on `PATH`.

## Diagnostics

Diagnostics are written to stderr as `severity: [CODE] file:line:col message`.

- unsupported constructs produce explicit errors or warnings
- the reflector does not silently widen unsupported TS types into fake JSON shapes
- scaffold generation prefers visible TODO stubs over lying handlers
