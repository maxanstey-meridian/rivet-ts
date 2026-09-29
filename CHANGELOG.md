# Changelog

## Unreleased — breaking

- The lowering entry point is now the synchronous function `lowerContracts(entryPath, { tsconfigPath? })`. The `TypeScriptRivetContractLowerer` class, the `RivetContractLowerer` port, the `LowerTsContractsToRivetContract` use case and its deprecated `LowerContractBundleToRivetContract` alias are removed from the `rivet-ts` export. Replace `await new LowerTsContractsToRivetContract(new TypeScriptRivetContractLowerer(tsconfig)).execute({ entryPath })` with `lowerContracts(entryPath, { tsconfigPath: tsconfig })`.
- `rivet-ts rivet --help` / `rivet-ts rivet -- --version` now reach the Rivet binary instead of printing rivet-ts's own usage/version.
- Removed the `rivet-ts/local` entry point (`configureLocalRivet`, `createLocalRivetFetch`, `LocalRivetConfig`). The scaffolds no longer use it.
- Removed the lowerer-internal exports `EndpointExampleSpec`, `ResponseExamplesSpec` and the unused `RivetEndpointExample` class.
- `RivetContractLoweringResult` no longer has `toJSON()`: `JSON.stringify(result)` now serialises the whole result, not just its document. Use `result.toJson()` or `result.document`.
- `RivetRequestExample` and `RivetResponseExample` are merged into one `RivetExample` class, and the `EndpointExampleValue` type export is removed (use `RivetEndpointExampleValue`). The contract JSON is unchanged.
- `registerRivetHonoRoutes({ group })` matches endpoints by `controllerName` only. The contract JSON never carried an endpoint `group`, so only hand-written contract objects that set one are affected.

## Unreleased — fixes

- A standalone `null` property type reports `UNSUPPORTED_NULL_TYPE` with the `T | null` hint (it fell through to a generic "Unsupported type expression"), and a computed endpoint member name says so instead of "Only identifier endpoint names are supported".
- The Vite plugin watches every module the contract program compiles, including modules imported through tsconfig `paths` aliases, and `scaffold-mock` copies the same set (both previously followed relative import specifiers only).
- `Contract`, `Endpoint`, `Brand` and `Format` are recognised by symbol, so renamed imports (`import type { Endpoint as E }`) work and a contract's own type that happens to be called `Contract`, `Brand` or `Format` is no longer mistaken for the rivet-ts one. `Array`/`ReadonlyArray`/`Record`/`Date`/`Blob`/`File` are recognised only as the library types.
- Endpoint-spec literals resolve through aliases (`type Get = "GET"; method: Get`, `Contract<Name>`), negative literal types (`-1 | 1`) lower, and enums lower any constant member value (`Write = 1 << 1`).
- Response examples on a body-forbidden status (1xx, 204, 205, 304) are a lowering error (`BODY_FORBIDDEN_STATUS_EXAMPLE`) with C# Rivet's RIV1102 wording, instead of contract JSON that `rivet --from` then refuses.
- Example lists must be arrays or tuples (`T[]`, `[A, B]`, `Array<T>`, `ReadonlyArray<T>`); `Promise<T>`, `Record<…>`, `String`, `Number` and `Boolean` are no longer accepted as example-list containers.
- Malformed `name`/`mediaType` on a `responseExamples` descriptor is reported against `responseExamples[<status>].examples entries`, not `requestExamples entries`.
- `rivet-ts --entry` accepts `--tsconfig <file>` (it previously rejected the flag, so a non-default tsconfig could not be used).
- `rivet-ts rivet` no longer kills the Rivet binary after 1 MB of output, and reports a signal-killed binary as `128 + signal`.
- The Vite plugin no longer fails on more than 1 MB of Rivet output, and fails the build when one Rivet run exceeds `rivet.timeoutMs` (default 120 s).
- `scaffold-mock` no longer overflows the stack on a generic type whose type argument is the outer type parameter (`Page<T> { data: Wrapper<T> }`) when emitting Zod schemas.
