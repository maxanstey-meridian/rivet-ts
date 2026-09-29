# Changelog

## Unreleased — breaking

- The lowering entry point is now the synchronous function `lowerContracts(entryPath, { tsconfigPath? })`. The `TypeScriptRivetContractLowerer` class, the `RivetContractLowerer` port, the `LowerTsContractsToRivetContract` use case and its deprecated `LowerContractBundleToRivetContract` alias are removed from the `rivet-ts` export. Replace `await new LowerTsContractsToRivetContract(new TypeScriptRivetContractLowerer(tsconfig)).execute({ entryPath })` with `lowerContracts(entryPath, { tsconfigPath: tsconfig })`.
- `rivet-ts rivet --help` / `rivet-ts rivet -- --version` now reach the Rivet binary instead of printing rivet-ts's own usage/version.
- Removed the `rivet-ts/local` entry point (`configureLocalRivet`, `createLocalRivetFetch`, `LocalRivetConfig`). The scaffolds no longer use it.
- Removed the lowerer-internal exports `EndpointExampleSpec`, `ResponseExamplesSpec` and the unused `RivetEndpointExample` class.
- `RivetContractLoweringResult` no longer has `toJSON()`: `JSON.stringify(result)` now serialises the whole result, not just its document. Use `result.toJson()` or `result.document`.
- The Rivet binary auto-install refuses a release asset that publishes no sha256 digest instead of installing it unverified. Set `rivet.binaryPath` to use a binary you have verified yourself.
- CLI usage errors now come from `node:util` `parseArgs`: `Unknown option '--x'` and `Option '--x <value>' argument missing` replace `Unknown argument: --x` and `Flag --x is missing a value.`; a stray positional argument is `Unexpected argument`.
- `RIVET_VERSION` must be a release version (`0.44.1`, `v0.44.1`, `0.44.1-rc.1`); anything else fails instead of being used as a tag.
- `registerRivetHonoRoutes({ group })` matches endpoints by `controllerName` only. The contract JSON never carried an endpoint `group`, so only hand-written contract objects that set one are affected.

## Unreleased — fixes

- The Vite plugin honours `RIVET_VERSION` like the CLI (an explicit `rivet.version` still wins).

- `rivet-ts --entry` accepts `--tsconfig <file>` (it previously rejected the flag, so a non-default tsconfig could not be used).
- `rivet-ts rivet` no longer kills the Rivet binary after 1 MB of output, and reports a signal-killed binary as `128 + signal`.
- The Vite plugin no longer fails on more than 1 MB of Rivet output, and fails the build when one Rivet run exceeds `rivet.timeoutMs` (default 120 s).
- `scaffold-mock` no longer overflows the stack on a generic type whose type argument is the outer type parameter (`Page<T> { data: Wrapper<T> }`) when emitting Zod schemas.
