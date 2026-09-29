# Changelog

## Unreleased — breaking

- The lowering entry point is now the synchronous function `lowerContracts(entryPath, { tsconfigPath? })`. The `TypeScriptRivetContractLowerer` class, the `RivetContractLowerer` port, the `LowerTsContractsToRivetContract` use case and its deprecated `LowerContractBundleToRivetContract` alias are removed from the `rivet-ts` export. Replace `await new LowerTsContractsToRivetContract(new TypeScriptRivetContractLowerer(tsconfig)).execute({ entryPath })` with `lowerContracts(entryPath, { tsconfigPath: tsconfig })`.
- `rivet-ts rivet --help` / `rivet-ts rivet -- --version` now reach the Rivet binary instead of printing rivet-ts's own usage/version.
- Removed the `rivet-ts/local` entry point (`configureLocalRivet`, `createLocalRivetFetch`, `LocalRivetConfig`). The scaffolds no longer use it.
- Removed the lowerer-internal exports `EndpointExampleSpec`, `ResponseExamplesSpec` and the unused `RivetEndpointExample` class.
- `RivetContractLoweringResult` no longer has `toJSON()`: `JSON.stringify(result)` now serialises the whole result, not just its document. Use `result.toJson()` or `result.document`.
- `registerRivetHonoRoutes({ group })` matches endpoints by `controllerName` only. The contract JSON never carried an endpoint `group`, so only hand-written contract objects that set one are affected.
- Scaffolds (`scaffold`, `scaffold-mock`) now pin `zod`, `@hono/node-server` and `dexie` to the versions rivet-ts itself builds and tests against (from its own `package.json`): `@hono/node-server` `^1.14.0` → `^2.0.4`, `zod` `^4.3.6` → `^4.4.3`, `dexie` `^4.0.0` → `^4.4.3`.
- `DiscoveredContract` gains `controllerName` and `DiscoveredEndpoint` gains `loweredName` (the lowered document's names), so hand-built values of these types need them.
- Scaffolds emit `apps/api/src/http-errors.ts` — `parseBody(schema, body)` (the 422 `validation_failed` envelope) and `handleUnexpectedError` (the structured 500) — and scaffolded routes and `app.ts` call it instead of inlining both blocks. `scaffold-mock` refuses a contract source file that would land on `apps/api/src/http-errors.ts`.

## Unreleased — fixes

- `rivet-ts --entry` accepts `--tsconfig <file>` (it previously rejected the flag, so a non-default tsconfig could not be used).
- `rivet-ts rivet` no longer kills the Rivet binary after 1 MB of output, and reports a signal-killed binary as `128 + signal`.
- The Vite plugin no longer fails on more than 1 MB of Rivet output, and fails the build when one Rivet run exceeds `rivet.timeoutMs` (default 120 s).
- `scaffold-mock` no longer overflows the stack on a generic type whose type argument is the outer type parameter (`Page<T> { data: Wrapper<T> }`) when emitting Zod schemas.
- `scaffold-mock` refuses (with `Endpoint "<Contract>.<Endpoint>" is missing from the lowered contract document.`) when a contract endpoint has no lowered counterpart, instead of silently scaffolding without its handler.
