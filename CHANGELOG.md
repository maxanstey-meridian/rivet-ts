# Changelog

## Unreleased — breaking

- The default Rivet pin moves from `v0.44.1` to `v0.45.0`. Its `--from` is stricter about the contract JSON, a nullable property is no longer implicitly optional (rivet-ts already writes explicit optionality, so its output is unaffected), the `FileRouteDefinition.ContentType` alias is gone, and duplicate response header names per status are refused (RIV1109). The contract JSON schema is unchanged. Set `RIVET_VERSION` or `rivet.version` to stay on an older release.
- `RivetHandlerInput` (and so `RivetHandler`) now matches what `rivet-ts/hono` delivers, following the params the endpoint lowers to. Every route `{placeholder}` is under `params` (typed from the `params`/`input` key naming it, else `string`): a multipart endpoint's `body` no longer lists its route keys, a `GET`/`DELETE` input's route keys moved from `query` to `params` (and `query` is absent when nothing is left), a body method gains `params` for its placeholders, and a route with placeholders but no `input` now takes `{ params }` instead of no argument. With explicit `params`/`query`, `input` is `body` on every method, as the lowerer emits it. Handlers that read a route value from `body` or `query` got `undefined` at runtime; read it from `params`.
- `DiscoveredEndpoint` drops `hasInput`, `hasParams` and `hasQuery`; `scaffold-mock` now derives the handler input from the lowered params, so a scaffolded route with only placeholders (`DELETE /members/{id}`) forwards `{ params }` to its use case instead of `{}`.
- Scaffolds (`scaffold`, `scaffold-mock`) no longer emit `apps/api/src/contract.ts`, which only re-exported the contract interfaces (Plumb MER-FE-030): the api package's `#contract` import alias points at the contract entry itself (`./src/contracts.ts`, or the copied entry's path). A copied contract source named `contract.ts` no longer collides with an emitted file.

## Unreleased — fixes

- `registerRivetHonoRoutes` binds a route placeholder to the contract param it matches case-insensitively, as the lowerer does: `route: "/teams/{TeamId}"` with `input: { teamId }` answered 400 `MISSING_REQUIRED_PARAMETER` on `GET`/`DELETE`/multipart endpoints.
- The scaffolded `Taskfile.yml`'s `plumb` task runs `${PLUMB:-plumb} .` (the `PLUMB` executable, else `plumb` on `PATH`) instead of the nonexistent `~/.meridian/plumb/plumb`.
- `scaffold-mock` no longer reports a generic nested in itself with other arguments (`Nested<T> = { outer: Box<Box<T>> }`) as recursive: the mock is synthesized instead of a TODO stub, and the body schema is exact instead of `z.unknown()`. Recursion is detected per instantiation, and a generic whose instantiations keep nesting (`Tree<T> = { child: Tree<Box<T>> }`) is still treated as recursive.

## 0.14.0 — breaking

- The lowering entry point is now the synchronous function `lowerContracts(entryPath, { tsconfigPath? })`. The `TypeScriptRivetContractLowerer` class, the `RivetContractLowerer` port, the `LowerTsContractsToRivetContract` use case and its deprecated `LowerContractBundleToRivetContract` alias are removed from the `rivet-ts` export. Replace `await new LowerTsContractsToRivetContract(new TypeScriptRivetContractLowerer(tsconfig)).execute({ entryPath })` with `lowerContracts(entryPath, { tsconfigPath: tsconfig })`.
- `rivet-ts rivet --help` / `rivet-ts rivet -- --version` now reach the Rivet binary instead of printing rivet-ts's own usage/version.
- Removed the `rivet-ts/local` entry point (`configureLocalRivet`, `createLocalRivetFetch`, `LocalRivetConfig`). The scaffolds no longer use it.
- Removed the lowerer-internal exports `EndpointExampleSpec`, `ResponseExamplesSpec` and the unused `RivetEndpointExample` class.
- `RivetContractLoweringResult` no longer has `toJSON()`: `JSON.stringify(result)` now serialises the whole result, not just its document. Use `result.toJson()` or `result.document`.
- `RivetRequestExample` and `RivetResponseExample` are merged into one `RivetExample` class, and the `EndpointExampleValue` type export is removed (use `RivetEndpointExampleValue`). The contract JSON is unchanged.
- The Vite plugin's `contract` option (an alias of `entry`) is removed; `entry` is required. Rename `contract:` to `entry:` in `vite.config.ts`.
- The Rivet binary auto-install refuses a release asset that publishes no sha256 digest instead of installing it unverified. Set `rivet.binaryPath` to use a binary you have verified yourself.
- CLI usage errors now come from `node:util` `parseArgs`: `Unknown option '--x'` and `Option '--x <value>' argument missing` replace `Unknown argument: --x` and `Flag --x is missing a value.`; a stray positional argument is `Unexpected argument`.
- `RIVET_VERSION` must be a release version (`0.44.1`, `v0.44.1`, `0.44.1-rc.1`); anything else fails instead of being used as a tag. It is only read when it picks the release, so an explicit `rivet.version` or `rivet.binaryPath` ignores it.
- `registerRivetHonoRoutes({ group })` matches endpoints by `controllerName` only. The contract JSON never carried an endpoint `group`, so only hand-written contract objects that set one are affected.
- Scaffolds (`scaffold`, `scaffold-mock`) now pin `zod`, `@hono/node-server` and `dexie` to the versions rivet-ts itself builds and tests against (from its own `package.json`): `@hono/node-server` `^1.14.0` → `^2.0.4`, `zod` `^4.3.6` → `^4.4.3`, `dexie` `^4.0.0` → `^4.4.3`.
- `DiscoveredContract` gains `controllerName` and `DiscoveredEndpoint` gains `loweredName` (the lowered document's names), so hand-built values of these types need them.
- Scaffolds emit `apps/api/src/http-errors.ts` — `parseBody(schema, body)` (the 422 `validation_failed` envelope) and `handleUnexpectedError` (the structured 500) — and scaffolded routes and `app.ts` call it instead of inlining both blocks. `scaffold-mock` refuses a contract source file that would land on `apps/api/src/http-errors.ts`.
- `RivetHttpError` extends Hono's `HTTPException` (so `instanceof HTTPException` and Hono's error handling recognise it; `getResponse()` builds its response). Its status and `rivetHttpError`'s are Hono's `ContentfulStatusCode`, so the type refuses 204/205/304, where `rivetHttpError(304, undefined)` used to answer an empty 304; at runtime only a body on one of those statuses is refused (a `TypeError`). `headers` is always set (`{}` when none are given).
- `ContractJson` (the `rivet-ts/hono` contract parameter) is derived from the lowered contract document: every param needs `type` and `isOptional`, and every endpoint `controllerName`, as `rivet-ts --out` always writes them. Only hand-written contract objects are affected.
- `registerRivetHonoRoutes` reports a handler map entry whose value is `undefined` as a missing handler at registration, rather than failing when the route is requested.
- The repository no longer ships the legacy `samples/myapp` workspace (pinned to rivet-ts 0.9.1, untested, importing files that no longer exist). Run `rivet-ts scaffold` or `rivet-ts scaffold-mock` for a current reference app.
- The default Rivet pin moves from `v0.40.0` to `v0.44.1` (the latest published release). Its `--from` refuses a `.Secure(name)` endpoint unless the scheme is defined with `--security name=<spec>` (RIV2002). Set `RIVET_VERSION` or `rivet.version` to stay on an older release.

## 0.14.0 — fixes

- A standalone `null` property type reports `UNSUPPORTED_NULL_TYPE` with the `T | null` hint (it fell through to a generic "Unsupported type expression"), and a computed or numeric endpoint member name is reported as such instead of "Only identifier endpoint names are supported".
- The Vite plugin watches every module the contract program compiles, including modules imported through tsconfig `paths` aliases, and `scaffold-mock` copies the same set (both previously followed relative import specifiers only).
- `Contract`, `Endpoint`, `Brand` and `Format` are recognised by symbol, so renamed imports (`import type { Endpoint as E }`) work and a contract's own type that happens to be called `Contract`, `Brand` or `Format` is no longer mistaken for the rivet-ts one. `Array`/`ReadonlyArray`/`Record`/`Date`/`Blob`/`File` are recognised only as the library types.
- Endpoint-spec literals resolve through aliases (`type Get = "GET"; method: Get`, `Contract<Name>`), negative literal types (`-1 | 1`) lower, and enums lower any finite constant member value (`Write = 1 << 1`); `Infinity`/`NaN` members (`A = 1 / 0`) are still refused.
- Response examples on a body-forbidden status (1xx, 204, 205, 304) are a lowering error (`BODY_FORBIDDEN_STATUS_EXAMPLE`) with C# Rivet's RIV1102 wording, instead of contract JSON that `rivet --from` then refuses.
- Example lists must be arrays or tuples (`T[]`, `[A, B]`, `Array<T>`, `ReadonlyArray<T>`); `Promise<T>`, `Record<…>`, `String`, `Number` and `Boolean` are no longer accepted as example-list containers.
- Malformed `name`/`mediaType` on a `responseExamples` descriptor is reported against `responseExamples[<status>].examples entries`, not `requestExamples entries`.
- The Vite plugin honours `RIVET_VERSION` like the CLI (an explicit `rivet.version` still wins).
- `rivet-ts --entry` accepts `--tsconfig <file>` (it previously rejected the flag, so a non-default tsconfig could not be used).
- `rivet-ts rivet` no longer kills the Rivet binary after 1 MB of output, and reports a signal-killed binary as `128 + signal`.
- The Vite plugin no longer fails on more than 1 MB of Rivet output, and fails the build when one Rivet run exceeds `rivet.timeoutMs` (default 120 s).
- `scaffold-mock` no longer overflows the stack on a generic type whose type argument is the outer type parameter (`Page<T> { data: Wrapper<T> }`) when emitting Zod schemas.
- `scaffold-mock` refuses (with `Endpoint "<Contract>.<Endpoint>" is missing from the lowered contract document.`) when a contract endpoint has no lowered counterpart, instead of silently scaffolding without its handler.
- Scaffolded `.oxlintrc.json` ignores `**/generated/**`, so oxlint skips the generated contract JSON, OpenAPI and `schema.d.ts` artifacts (Plumb MER-TO-003 on every fresh scaffold).
- `errors`, `requestExamples` and `responseExamples` resolve a list type alias imported from another file (`errors: ApiErrors`), where they reported `INVALID_ERRORS_SPEC` / `INVALID_ENDPOINT_EXAMPLE_REFERENCE` / `INVALID_RESPONSE_EXAMPLES_SPEC`.
