# FABLE_REVIEW.md — rivet-ts code review

Reviewed 2026-06-10. Methodology: four parallel deep-review passes (extraction pipeline; domain model + .NET interop; Hono/Vite/scaffold runtime; CLI/tests/docs/packaging), with the highest-severity claims independently re-verified against the source, against `~/Sites/medway/rivet` (schema, `Rivet.Tool/Model`, `JsonContractReader`, `ClientEmitter`), and in many cases empirically — by running the compiled pipeline on repro fixtures, running the .NET tool's `--from` over rivet-ts golden contracts, schema-validating output, packing/installing the tarball, and running `scaffold-mock` for real.

Findings marked **[verified]** were reproduced or directly confirmed during the review; the rest were confirmed by reading the actual code paths (no speculation).

Companion document: `~/Sites/medway/rivet/FABLE_REVIEW.md` covers the .NET side. Several findings here have .NET-side counterparts or require coordinated fixes — these are cross-referenced.

**Overall verdict.** The codebase is genuinely solid: clean layering, real tests (no snapshot tautologies; a pack→install→exec consumer test; `expectTypeOf` type-level assertions; a real `vite build` integration test). The handwaving concentrates in exactly the two claims the project makes: (1) the .NET contract interop is ~95% aligned but has field-level mismatches causing silent semantic loss, and every emitted contract fails the published JSON schema; (2) the Hono runtime systematically promises more in its types than it delivers at runtime, and the scaffold emits projects that don't compile in several realistic configurations. Structurally, the frontend/lowerer split in the extraction pipeline duplicates ~800 lines that have already diverged and double the dominant cost of every run.

---

## 1. .NET contract interop (the "works as it claims" claim)

Ground truth: `rivet/rivet-contract-schema.json`, `Rivet.Tool/Model/*.cs`, `Rivet.Tool/Emit/JsonContractReader.cs`, plus an empirical end-to-end run feeding rivet-ts golden contracts to the built .NET tool.

What's right (checked, no issue): type-kind discriminators; `taggedUnion`/`inlineObject`/`brand` shapes; `csharpType`/`format` on primitives; `stringUnion`/`intUnion` enum representations; `source` values including `formField`; property-level `optional`/`readOnly`/`writeOnly`; example `json`/`resolvedJson` as JSON-encoded strings; uppercase `httpMethod`; default success statuses (200/201/204) agree between both extractors; `fileContentType` defaulting.

### N1. CRITICAL — optional endpoint params become required in .NET-generated clients (`optional` vs `isOptional`) [verified]

`src/domain/rivet-contract.ts:198-215` vs `rivet/Rivet.Tool/Model/TsEndpointDefinition.cs:44` and `rivet-contract-schema.json:233`.

rivet-ts serializes `RivetEndpointParam.optional`; the .NET model is `IsOptional` (camelCased `isOptional`). `JsonContractReader` silently ignores the unknown `optional` key, so `IsOptional` is always `false`. Compounding it, .NET's `ClientEmitter.IsParamOptional` (`ClientEmitter.cs:505-527`) never consults `param.IsOptional` at all — only type-level nullability — and `OpenApiEmitter.cs:146` likewise.

**Verified end-to-end:** running the .NET tool over `tests/fixtures/expressive-contract/golden-contract.json` generates a `search` client method where `priority`, `includeInactive`, and `sort` — all `"optional": true` in the contract — are emitted **required**. The only params that stay optional are those whose types happen to be `nullable`.

Fix needs both repos: rename the serialized key to `isOptional` here, and make the .NET emitters honour `param.IsOptional` (add to the rivet repo's fix list).

### N2. CRITICAL — every contract rivet-ts emits fails the published Rivet contract schema [verified]

Consequence of N1, but it falsifies the interop claim at the spec level: validating all six rivet-ts golden fixtures against `rivet/rivet-contract-schema.json` (Draft 2020-12) fails on **every file** with `Additional properties are not allowed ('optional' was unexpected)` at `endpoints/*/params/*`. Any consumer that schema-validates contracts (CI, third-party tooling) rejects rivet-ts output wholesale.

### N3. HIGH — `queryAuth` silently dropped on the .NET `--from` path [verified]

`rivet/Rivet.Tool/Emit/JsonContractReader.cs:38-56` maps 14 of 16 `ContractEndpoint` fields but omits `QueryAuth` (and `IsFileEndpoint`, which is benign — re-derived from `FileContentType`). rivet-ts lowers `queryAuth: true | "name"` correctly (`typescript-rivet-contract-lowerer.ts:528-534, 612`), the schema documents it, and the reader discards it. **Verified:** a contract with `"queryAuth": {"parameterName": "token"}` run through `--from` produced a client with no `token` parameter anywhere. TS-authored query-token auth vanishes with zero diagnostics. Fix belongs in the rivet repo; rivet-ts ships the claim.

### N4. HIGH — `RivetSuccessResult` types POST as `status: 200` while the runtime returns 201 [verified]

`src/domain/runtime-types.ts:14-16`: `SuccessStatus<TSpec>` defaults to `200` when no `successStatus` is authored. But the lowerer defaults POST→201/DELETE→204 (`typescript-rivet-contract-lowerer.ts:2173-2182`, mirrored in the frontend and .NET `ContractWalker.cs:393`), and the Hono adapter returns the contract's status (`src/hono.ts:211-217, 361`). User code narrowing on `result.status === 200` type-checks but never matches at runtime for a default POST. `SuccessStatus` must be method-aware, same as the lowerer. (Same 201/204 propagation family as finding A1 in the .NET review.)

### N5. MEDIUM — alias type definitions emit both `properties: []` and `type`, violating the schema's `oneOf`

`src/domain/rivet-contract.ts:164-184`: `RivetTypeDefinition.properties` defaults to `[]` and is always serialized, so an alias (lowered at `lowerer:867`) matches both `oneOf` branches in `rivet-contract-schema.json:199-202` → validation failure. The .NET reader tolerates it (`JsonContractReader.cs:77-82` prefers `Type`); the .NET emitter omits `properties` for aliases — rivet-ts should too.

### N6. LOW — `RivetEndpointExample` class is dead and schema-divergent

`src/domain/rivet-contract.ts:84-90`: a `{ data }` shape matching nothing in the schema (`endpointExample` is `{ mediaType, name?, json?, componentExampleId?, resolvedJson? }`); zero usages beyond the public export at `src/index.ts:51`. It invites authors to construct examples the .NET side can't read. Delete or align.

### N7. Recommended — cross-repo conformance test

Run the .NET tool's `--from` over every rivet-ts golden contract, and schema-validate rivet-ts output against `rivet-contract-schema.json`, in CI. That single test would have caught N1, N2, N3, and N5.

---

## 2. Hono runtime (`src/hono.ts`, `src/local.ts`, handler/runtime types)

### H1. HIGH — handler input typed as `body` for GET `input`, delivered as `query`/`params` at runtime [verified]

`src/domain/handler-types.ts:16-20` (`HandlerInputBag` maps any spec with `input` to `{ readonly body: T }`) vs `src/hono.ts:166-209`. For GET/DELETE the lowerer turns `input` properties into route/query params with no body param (`BODY_HTTP_METHODS` gate, `lowerer:941-1040`), and `buildHandlerInput` only sets `input.body` when a body/file/formField param exists. A handler for `Endpoint<{ method: "GET"; route: "/x"; input: { q?: string } }>` is typed `(input: { body: { q?: string } })` yet receives `{ query: { q: "..." } }` — `input.body` is `undefined` at runtime.

### H2. HIGH — query/route params are raw strings, first-value-only, no validation, while the types promise the authored types [verified]

`src/hono.ts:196-206`. `context.req.query(name)` returns only the first value, always a string; no coercion, no required-param validation. **Verified:** `?tags=a&tags=b` against a handler typed `{ tags: string[] }` receives `{ tags: "a" }`; a missing declared query param is silently `undefined` while typed non-optional. `number`/`boolean`/enum/array query and route params are a flat type lie, and there's no 400 for missing required params (the .NET implementation binds and validates these). At minimum: `context.req.queries()` for array-typed params, plus coercion/validation of primitives.

### H3. HIGH — invalid/missing JSON body → 500, and in scaffolded local mode a _rejected fetch promise_ [verified]

`src/hono.ts:192`: `await context.req.json()` with no try/catch and no content-type check. Malformed/empty body on a body-declaring endpoint throws `SyntaxError`, not a `RivetHttpError`, so it's rethrown (`hono.ts:395`). **Verified:** `POST {nope` → 500. Worse, the scaffolded app's `onError` _rethrows_ unmapped errors (see S5), and a rethrow from `onError` escapes `app.request(...)` entirely — **verified:** the dispatch promise rejects instead of producing any Response. The .NET side returns 400 for binding failures.

### H4. MEDIUM — omitting `group` with multi-contract documents silently binds one handler to several distinct endpoints

`src/hono.ts:313-347`. Without `options.group`, all endpoints are selected; the flat handler-map key `Get` matches every endpoint named `get` across all groups — different routes, different shapes — no error. The duplicate-match guard at `:342` only catches multiple keys per endpoint, not multiple endpoints per key. `docs/guides/hono.md` doesn't warn about this.

### H5. MEDIUM — status/method conformance gaps

`src/hono.ts:384-393, 211-217, 360`: `rivetHttpError(304, data)` silently drops `data` (as do 204/205); `getSuccessStatus` falls back to 200 when `responses` has no 2xx entry (possible — see X14: GET+void lowers to an empty responses array), so the adapter and contract disagree; nothing validates `endpoint.httpMethod` is a Hono method — a HEAD/OPTIONS contract would crash with `app[method] is not a function`.

### H6. MEDIUM — multipart/form binding has no missing-field validation

`src/hono.ts:182-189`: absent file/form fields arrive as `undefined` where the handler type promises `File`/`string`; duplicate same-name fields take Hono's last-value semantics. No 400.

### H7. LOW — route constraints/catch-alls break silently

`src/hono.ts:70` converts `{id}` → `:id` naively; `"/files/{*path}"` or `{id:int}` produce Hono patterns (`:*path`, `:id:int`) that won't match as intended. The lowerer's `ROUTE_PARAM_PATTERN` (`lowerer:64`) likewise treats `id:int` as a param literally named `"id:int"` (see X22). No validation on either side.

### H8. LOW — doc/test contradiction on class-handler instantiation

`src/hono.ts:363-372` constructs zero-arg class handlers per request (matching `docs/guides/hono.md`), but `tests/integration/hono.runtime.lifecycle.test.ts:219` is titled "instantiates zero-arg class handlers once by default" and asserts nothing about instantiation count. The test name is stale.

---

## 3. Scaffold (`scaffold-mock`: mock-project-emitter, mock-value-generator)

### S1. CRITICAL — two contracts sharing an endpoint name → non-compiling `app.ts` [verified]

`src/infrastructure/scaffold/mock-project-emitter.ts:344-348` (and `:193`): `handlerExportName` is derived purely from the endpoint name, not qualified by contract/module. Two contracts each declaring `Get` produce duplicate `import { getHandler }` statements — a TS duplicate-identifier error — plus ambiguous bindings in both `registerRivetHonoRoutes` blocks. **Verified by running `scaffold-mock`** on the project's own PetContract/SummaryContract test-fixture shape. The existing lifecycle test exercises exactly this scenario but only greps strings and never typechecks the output, so it passes.

### S2. CRITICAL — infinite recursion in mock generation for nested generics reusing a type-parameter name [verified]

`src/infrastructure/scaffold/mock-value-generator.ts:53-68` (`withSubstitutions`) and `:279-289`. `withSubstitutions` merges `typeArgs` without resolving them against the outer substitutions first. For `Page<T> { data: Wrapper<T> }`, lowering `Page<MemberDto>` sets `T → MemberDto`, then entering `Wrapper<T>` sets `T → typeParam("T")` — self-referential; the `typeParam` case resolves `T` forever. **Verified:** `RangeError: Maximum call stack size exceeded`, killing the whole `scaffold-mock` run. `T` is the most common parameter name, so this is the _default_ naming. Fix: resolve each `typeArg` through `context.substitutions` before inserting (or per-frame scopes).

### S3. HIGH — scaffolded project imports `generated/api.contract.json` that is never written [verified]

`mock-project-emitter.ts:335,486` vs `src/application/use-cases/scaffold-mock-project.ts:50-58`. The use case passes `contractJsonFileName` and the lowered `document` to the emitter; the emitter never writes the JSON — it only `mkdir`s the empty `generated/` directory (zero grep hits for `contractJsonFileName` in the emitter; **verified:** `out/packages/api/generated/` empty after scaffold). The emitted `app.ts` does `import contract from "../generated/api.contract.json"` and the root tsconfig pulls `app.ts` in transitively, so a fresh scaffold fails `pnpm check`/`pnpm test` with TS2307 until `vite dev`/`pnpm generate` is first run. The data needed is already passed in.

### S4. HIGH — entry file must literally be named `contracts.ts` (with no imports above its directory) or the scaffold is silently broken

`mock-project-emitter.ts:294-301` hardcodes `from "./contracts.js"` in the emitted `contract.ts`; `:486` hardcodes the vite entry `./packages/api/src/app/contracts.ts`. The emitter computes `entryDependency` (where the entry actually lands after copying, `:806-813`) and never uses it beyond an existence check. Entry named `my-contracts.ts` → copied to `src/app/my-contracts.ts`, both references dangle. Entry importing `../models.ts` → the common-root logic in `local-source-dependencies.ts:119-123` nests the entry under a subdirectory, same dangling result. No validation, exit code 0, non-compiling project.

### S5. HIGH — scaffolded `onError` rethrow breaks local/server behavioral parity for all unhandled handler errors [verified]

`mock-project-emitter.ts:372-379` + `src/local.ts:20-23`. Any handler exception — including the scaffold's own generated `throw new Error("TODO: ...")` bodies (`:178`) — propagates through the rethrowing `onError` and **rejects the `app.request` promise** in local mode (verified), while the same exception on a real server (`Bun.serve({ fetch: app.fetch })` per the docs) becomes an HTTP 500 response. The client observes fundamentally different failure modes locally vs deployed, directly undermining `docs/guides/local-now-server-later.md`'s "same behavior" promise.

### S6. MEDIUM — re-running `scaffold-mock` clobbers user edits unconditionally

`mock-project-emitter.ts:849-930` + `run-cli.ts:32-90`: every file written unconditionally, no existence check, no `--force` flag — including `app.ts`, use-cases, handlers, and `ui/src/main.ts`, the files the docs tell users to edit. Related: a user dependency file named `contract.ts`, `composition.ts`, `local.ts`, or `map-contract-error.ts` is copied into `src/app/` (`:924-929`, which runs after the emit at `:849-891`) and clobbers the emitted file of the same name.

### S7. MEDIUM — mock values can produce non-compiling generated code; malformed stored examples crash the scaffold

`mock-value-generator.ts:44-51, 157-159, 173-184`: dictionaries with void-ish values emit `{ key: null }` (not assignable to most value types → scaffolded `tsc` failure); example-backed mocks are `JSON.parse`d and emitted verbatim with no conformance check against the response type; `parseExample`'s `JSON.parse` is uncaught — one malformed example string crashes the whole run.

### S8. MEDIUM/LOW — version pin, identifier hygiene, collisions

- `mock-project-emitter.ts:50`: `DEFAULT_RIVET_TS_DEPENDENCY = "github:maxanstey-meridian/rivet-ts#v0.9.1"` while the repo is v0.10.0 — every scaffold runs new-codegen output against the old runtime. Same stale pin in `docs/getting-started.md` and all three `samples/myapp` package.jsons. No test pins this constant to the package version.
- `:364, :236-237`: raw authored endpoint names interpolated as object keys / into string-literal type positions — an exotic interface property name yields invalid `app.ts`. (Group names are correctly `JSON.stringify`ed.)
- `:108-120`: contracts whose base names kebab-collide (`MembersContract` vs `Members`) map to the same module directory and silently overwrite each other's files; `buildHandlerDescriptors` (`:137-140`) silently `continue`s on lookup misses, deferring the failure to a runtime "No handler was provided".

---

## 4. Vite plugin (`src/vite.ts`) and binary bootstrap (`rivet-binary.ts`)

### V1. MEDIUM — all paths resolved against `process.cwd()`, not the Vite root

`src/vite.ts:35`. `vite -c myapp/vite.config.ts` from a parent directory (monorepo task runners, IDE runners) resolves `entry`/`apiRoot`/`clientOutDir` to the wrong place. The plugin's own integration test must `process.chdir(sampleRoot)` to work (`vite-plugin.lifecycle.test.ts:136`) — the test is masking the bug. Resolve against `config.root` in `configResolved`.

### V2. MEDIUM — dev server can't recover from a contract broken at startup

`src/vite.ts:135-136, 171-176`: the watched-file list is computed only at the end of a _successful_ `generateArtifacts`. If the contract has an error when `vite dev` starts, `watchedFiles` stays empty and `handleHotUpdate` (`:179`) never matches — fixing the file does nothing; the user must restart. Watch the entry (at least) regardless of extraction success.

### V3. LOW — every frontend diagnostic reported twice

`src/vite.ts:100` concatenates `bundle.diagnostics` with `lowered.diagnostics`, but the lowerer already seeds its result with `[...bundle.diagnostics]` (`lowerer:338`). (Same root cause as the CLI's duplicate `[ENTRY_NOT_FOUND]`, C4.)

### V4. LOW — transient inconsistent reloads mid-regeneration

`src/vite.ts:118-133`: contract JSON, client files, and `index.ts` are written sequentially while the watcher is live; Vite reacts to intermediate writes before the final `full-reload` (`:185`). Self-heals, but the browser can briefly load a half-regenerated client.

### B1. MEDIUM — `binaryPath` escape hatch still throws on unsupported platforms

`src/infrastructure/vite/rivet-binary.ts:125-131`: the explicit-`binaryPath` branch returns `rid: resolveRid()`, and `resolveRid` throws outside {osx-arm64, osx-x64, linux-x64, win-x64}. A linux-arm64 user who builds the binary themselves and sets `rivet.binaryPath` — the documented workaround — still gets "Unsupported platform". The rid is informational here; compute lazily.

### B2. MEDIUM — non-atomic install; interrupted extraction poisons the cache permanently

`rivet-binary.ts:142-192`: existence check is a bare `fs.access(executablePath)`; `tar.x` extracts directly into the final directory. Death mid-extraction/chmod leaves a truncated or non-executable binary that passes the check forever — no self-heal short of deleting `~/Library/Caches/rivet-ts`. No locking, so concurrent vite processes race. Fix: temp dir → verify → atomic `rename`.

### B3. MEDIUM/LOW — integrity and network gaps

`rivet-binary.ts:179-181`: sha256 verification runs only `if (asset.digest)` — absent digest → unverified extraction, no warning (and the digest shares the channel with the download, so it guards corruption, not compromise). No content-length check, timeout, or retry. Unauthenticated GitHub API calls (no `GITHUB_TOKEN` passthrough) hit the 60 req/hr limit in CI; Node's fetch ignores `HTTP(S)_PROXY`, so corporate-proxy users can't download at all.

(Otherwise solid: node-tar's default path sanitization is in effect; the cache is correctly keyed by tag+rid.)

---

## 5. Extraction pipeline (frontend + lowerer)

`frontend` = `src/infrastructure/typescript/typescript-contract-frontend.ts` (1761 lines), `lowerer` = `typescript-rivet-contract-lowerer.ts` (2183 lines).

### Structural

### X13. HIGH (structural) — the frontend/lowerer split duplicates ~800 lines, half the frontend's output is dead, and the project is type-checked twice per run

From the bundle, the lowerer actually uses only `name`, `method`, `formEncoded`, `acceptsFile`, and the examples — it re-locates spec nodes by name and re-parses route, successStatus, summary, description, security, errors, queryAuth, fileResponse, and anonymous from the AST. `TypeExpression.text`, `referencedSymbols`, `bundle.referencedTypes`, `EndpointSpec.params/query/response/input/errors[].response`, `successStatus`, `security`, `queryAuth` are computed by the frontend and **never consumed by any src code** (only tests assert them). The duplicates have already diverged: lowerer `readStringLiteral` accepts no-substitution templates, frontend `parseStringLiteral` doesn't; frontend parses numbers via `parseInt(getText())`, lowerer via `Number(literal.text)` (see X17); duplicated `getDefaultSuccessStatus`, `createPropertyMap`, `selectPropertyTypeNode`, `resolveAliasedTypeNode`, error-entry walkers. Each stage also builds its own full `ts.Program` (frontend `extract()` additionally runs `getPreEmitDiagnostics` — a full semantic check; lowerer `buildProgram` at `lowerer:74-81` starts from scratch, and `resolveTypeScriptProject` re-parses tsconfig both times), and every call site (`run-cli.ts:48-52`, `vite.ts:97-99`, scaffold) runs extract→lower back to back — doubling the dominant cost. This is the root cause of X1, V3, and the divergences. Recommended: collapse to a single AST→document pass with the bundle derived from it (or at least pass the frontend's program into the lowerer).

### Correctness

### X1. CRITICAL — cross-file endpoint-spec nodes corrupt the extracted bundle (`getText` with the wrong SourceFile) [verified]

`frontend:1663` (`parseTypeExpression`), `frontend:1630` (`parseNumericLiteral`), `frontend:1673` (`collectTypeReferences`). `createPropertyMap` resolves spec properties through the checker and can return type nodes declared in _other_ files; `parseTypeExpression` then calls `node.getText(sourceFile)` with the _entry_ file, indexing into the wrong file's text. **Verified:** a spec alias in `specs.ts` used as `Endpoint<ListUsersSpec>` in `contracts.ts` produces `response.text === "dex.js\";\nimport t"` (garbage) with zero diagnostics, and an imported `successStatus: 202` yields `successStatus: NaN`. The lowerer recomputes from the AST so the final JSON is right, but `extract()` is a public use case with silently corrupted IR. Fix: `node.getText(node.getSourceFile())` / literal `.text` accessors (the frontend already does this correctly in `createNodeDiagnostic`).

### X2. CRITICAL — generic endpoint-spec aliases lower the unsubstituted type parameter [verified]

`frontend:1148-1173`, `lowerer:1411-1433, 485+`. The property map is built from declaration TypeNodes without instantiating type arguments. **Verified:** `type CrudSpec<T> = {...; response: T }` with `Endpoint<CrudSpec<User>>` emits `returnType: { kind: "ref", name: "T" }` — `User` never emitted — plus a location-free `TYPE_NOT_FOUND "T"`, and the endpoint is still emitted, so a consumer ignoring diagnostics gets a structurally-valid wrong contract. Substitute type args via the checker, or reject generic spec aliases with a diagnostic at the `Endpoint<...>` node.

### X3. HIGH — route params silently dropped when `input` is present on a non-body method [verified]

`lowerer:1006-1043` (`buildEndpointParams`). For GET/DELETE with `input`, params derive _only_ from input properties; a route `{param}` with no matching property vanishes. **Verified:** `route: "/api/users/{id}/posts"; input: SearchQuery` (only `q`) emits one query param and **no route param `id`**, no diagnostic. The `!inputNode` branch and the body-method branch both emit fallback string route params — only this branch forgets. Same flaw in `buildExplicitEndpointParams` (`lowerer:874-940`): route params come exclusively from `params:`, so a missing placeholder is dropped, and a `params:` property absent from the route is emitted as `source: "route"` unvalidated.

### X4. HIGH — explicit `params:`/`query:` types that aren't plain object literals are silently discarded [verified]

`lowerer:884-926`. `getObjectProperties` (`lowerer:1555`) returns `null` for mapped types, generic references, intersections, aliases-of-aliases; `buildExplicitEndpointParams` does `if (properties)` with no else-diagnostic. **Verified:** `query: UserParams` where `type UserParams = Pick<UserFilter, "status">` → zero query params, zero diagnostics. (The non-explicit input path at least emits `UNSUPPORTED_INPUT_SHAPE`.) Note: **no fixture in the repo uses `params:`/`query:` at all** — `buildExplicitEndpointParams` is entirely untested.

### X5. HIGH — interface inheritance silently drops inherited properties [verified]

`lowerer:794-829` reads only `declaration.members`, never `heritageClauses`. **Verified:** `interface UserDto extends BaseDto { email: string }` lowers with only `email`; `id`/`createdAt` gone, `BaseDto` not emitted, no diagnostic. Breaks any DTO hierarchy. (The .NET side has the identical bug — finding A3 there — independently re-implemented.) Flatten via `checker.getApparentType` or diagnose the heritage clause.

### X6. HIGH — non-literal `Contract<...>` arguments silently skip the whole contract [verified]

`frontend:136-161`, `lowerer:148-170`. `type Name = "Users"; interface UsersContract extends Contract<Name>` → zero contracts, zero diagnostics (**verified**). Same for `extends Contract` with no type args, and for renamed imports (`import { Contract as C }` — comparison is raw text `=== "Contract"`). An interface that opted into the DSL should error, not vanish.

### X7. HIGH — `acceptsFile` bypassed when explicit `params:`/`query:` present [verified]

`lowerer:539-549`: the `paramsNode || queryNode` ternary routes to `buildExplicitEndpointParams`, which has no multipart handling. **Verified:** POST with `acceptsFile: true`, `input: { file: Blob; label: string }`, `query: {...}` emits `body: ref UploadInput` (no file/formField sources), a type containing `ref Blob`, then `TYPE_NOT_FOUND "Blob"` — while `requestExampleDefaultMediaType` is still `multipart/form-data` (`lowerer:578`). Internally contradictory output.

### X8. HIGH — `Date` (and anything from a `.d.ts`) fails with a context-free `TYPE_NOT_FOUND` [verified]

`lowerer:1842-1847` lowers `Date` to `ref Date`; `indexDeclarations` (`lowerer:250-252`) skips declaration files, so resolution fails with `TYPE_NOT_FOUND "Date"` — no file, no line, no hint toward `Format<string, "date-time">`. The dangling ref is still emitted. Same applies to shared-types packages shipping `.d.ts`.

### X9. MEDIUM — flat global type namespace across the whole program [verified]

`lowerer:244-289`: every exported enum/interface/alias in every non-declaration program file is indexed by bare name; two unrelated exported `Config` interfaces in never-referenced modules produce a hard `DUPLICATE_TYPE_NAME` error (**verified**). Refs resolve by name only (`lowerer:2156`) — module identity is discarded. At minimum, only error on duplicates actually referenced by a contract.

### X10. MEDIUM — common nullable/optional union shapes unsupported [verified]

`lowerer:1866-1942`: `foo: string | undefined` → `UNSUPPORTED_UNION` (while `foo?: string` works); `A | B | null` (nullable tagged union) → `UNSUPPORTED_UNION` because the null filter only applies when exactly one non-null member remains (`lowerer:1870-1871`). Both verified. Diagnosed but unguided, and nullable tagged unions are a natural authoring shape.

### X14. MEDIUM — response-list quirks [verified]

`lowerer:1205-1241`: GET + `response: void` produces an **empty `responses` array** (verified) while POST/DELETE void produce 201/204 entries — presence of the success response depends on the method (interacts with H5). `mergeResponseExamples` (`lowerer:1252-1254`) keys statuses last-index-wins, so duplicate-status error entries attach examples only to the last. `buildResponses` also rebuilds the spec property map instead of reusing the one from `lowerEndpoint`.

### X15. MEDIUM — `TYPE_NOT_FOUND` and example diagnostics carry no file/line

`lowerer:630-637, 1171-1179, 1259-1267` construct diagnostics without `filePath`. The referencing node is available at lowering time; thread it through.

### X16. MEDIUM — auto-numbered and negative enum members reject the whole enum

`lowerer:685-718`: `enum Role { Admin, User }` — the most idiomatic TS enum — errors `UNSUPPORTED_ENUM_MEMBER` and drops the enum; `= -1` (PrefixUnaryExpression) likewise. Implicit numbering is trivially computable.

### Low / hygiene

- **X17** `frontend:1630` parses numerics via `parseInt(getText(sourceFile))` — hex (`0x1F4` → `0`)/scientific mis-parse and the X1 cross-file hazard; lowerer's `Number(literal.text)` is correct. Bundle/document divergence.
- **X18** Unsupported HTTP method yields two diagnostics, one misleading (`frontend:314-338` then `frontend:224-233` adds `INCOMPLETE_ENDPOINT: must declare both method and route` even though both are declared).
- **X19** Copy-paste duplication inside the frontend: `getErrorEntryNodes`/`getRequestExampleEntryNodes` (`frontend:1175-1236`) are character-identical; `parseRequestExampleEntry`/`parseResponseExampleEntry` (~150 near-identical lines).
- **X20** `DEFAULT_COMPILER_OPTIONS` (`lowerer:48-59`) is dead — fully shadowed by `resolveTypeScriptProject`'s complete options; its NodeNext settings never apply and mislead readers.
- **X21** `collectTypeReferences` (`frontend:1666-1715`) misses index signatures, indexed-access, `typeof`, `keyof`, mapped and conditional types — currently harmless only because nothing consumes the output (X13).
- **X22** `ROUTE_PARAM_PATTERN` (`lowerer:64`) captures `{id:int}` as a param named `"id:int"` — can never match a property, emitted verbatim. If the .NET tool supports ASP.NET-style constraints, split on `:`.
- **X23** `Contract<"">` asymmetry: frontend accepts the empty name (`frontend:156`), lowerer requires `length > 0` (`lowerer:164`) → extraction succeeds, lowering reports `CONTRACT_NOT_FOUND`.
- **X24** `local-source-dependencies.ts:92` parses everything as `ScriptKind.TS` — `.tsx` dependencies get JSX-disabled mangled ASTs; dynamic `import()`/`require=` ignored; unresolvable local imports silently skipped.
- **X25** Dead/unused: `buildExplicitEndpointParams`'s `route`/`context` params (`lowerer:874-881`); `getTypeParameterScope` (`lowerer:1581`) effectively dead at all call sites; `RivetEndpointExample` (N6).
- **X26** Contracts/specs only discovered in the entry file's top-level statements (`frontend:70`, `lowerer:213`) — re-exported or imported contract interfaces silently ignored; undocumented.

---

## 6. Packaging, CLI, public API

### P1. HIGH — importing the root `rivet-ts` entry crashes at runtime when `hono` isn't installed [verified]

`src/index.ts:28`: `export { type RivetInvokable } from "./hono.js"` (inline-`type` form) under `verbatimModuleSyntax` compiles to `export {} from "./hono.js"` in `dist/index.js:2` — a **runtime** import of `dist/hono.js`, whose first line imports `hono`, an optional peer dep. **Verified from a packed tarball installed into a clean project:** `import('rivet-ts')` → `ERR_MODULE_NOT_FOUND: Cannot find package 'hono'`. It passes in-repo only because hono is a devDependency, and the consumer-smoke test never runtime-imports the package (contract files use erased `import type`). One-word fix: `export type { RivetInvokable }` (statement-level, fully elided). Also: `src/index.ts:70` re-exports the vite plugin (transitively `node:child_process`/`fs`) from the root entry — any value import from the root drags node-only modules into browser-bound graphs.

### C1. MEDIUM — no top-level CLI error handling [verified]

`src/interfaces/cli/main.ts:5-10` / `run-cli.ts:59`: only `runGenerate` try/catches. **Verified:** `--out /nonexistent-dir/c.json` dies with an unhandled ENOENT rejection and full internal stack trace. Catch in `main.ts`, wrap the `fs.writeFile` (and `mkdir -p` the parent).

### C2. MEDIUM — no `--help`/`--version`; fallback usage is wrong and exits 1 [verified]

`run-cli.ts:43`: `rivet-ts --help` prints `Usage: rivet-reflect-ts --entry <path> [--out <file>]` to stderr, exit 1 — omitting the `scaffold-mock` and `generate` subcommands entirely, under the wrong binary name, as a failure.

### C3. MEDIUM — unknown flags and dangling flag values silently ignored

`run-cli.ts:114-196`: all three parsers skip unmatched args. `--out` as the final arg (missing value) silently redirects the contract to stdout; `--tsconfg` typo silently scaffolds with defaults. No "unknown argument" diagnostic anywhere.

### C4. LOW — duplicate diagnostics; silent empty output [verified]

Missing entry prints `[ENTRY_NOT_FOUND]` twice (same root cause as V3). An entry with no `Contract` interfaces at all produces `{"types":[],"enums":[],"endpoints":[]}`, exit 0, zero warnings — an easy wrong-`--entry` footgun.

Verified non-issues: the exports map all resolves against real dist files; `dist/interfaces/cli/main.js` has its shebang and the packed CLI runs; `rivet-ts/vite` imports fine without vite (type-only import correctly erased); `"private": true` + GitHub-tag distribution with the `prepare` build is coherent (though undocumented); `typescript@^6` and `tar` as runtime deps are both genuinely needed.

---

## 7. Tests

Overall quality is genuinely good — no snapshots, no tautologies, real consumer/pack tests, `expectTypeOf` assertions, a real `vite build`. The gaps are where the verified bugs live:

- **T1.** `tests/integration/rivet-tool-from.lifecycle.test.ts:14` hardcodes `/Users/max/Sites/medway/rivet/Rivet.Tool` with no skip guard — the suite only passes on this machine with dotnet + the sibling repo. Add an env-var/path probe and `describe.skipIf`.
- **T2.** `scaffold-mock.lifecycle.test.ts` never typechecks its output — its own multi-contract fixture _is_ the S1 repro and its single-contract fixture _is_ the S3 repro. Running `tsc` (after S3 is fixed) against the scaffold output catches both.
- **T3.** `hono.runtime.lifecycle.test.ts`: zero query-param tests, no path-param encoding, no invalid-JSON-body, no unhandled-handler-error, no `RivetHttpError` headers/204, no multi-group/no-group registration. The class-handler test (`:219`) asserts nothing its name claims (H8).
- **T4.** `vite-plugin.lifecycle.test.ts` is build-only: no dev server, no HMR/regeneration, no failure recovery; the fake rivet binary means the real codegen handshake is untested; `process.chdir` masks V1.
- **T5.** No fixture uses explicit `params:`/`query:` (X3/X4/X7 territory); untested: generic spec aliases (X2), cross-file spec aliases (X1 — the aliased-authoring fixture keeps the alias in the entry file), DTO `extends` (X5), `Date`/`.d.ts` types (X8), nullable/undefined unions (X10), duplicate type names (X9), non-literal `Contract<>` args (X6).
- **T6.** Nothing pins `DEFAULT_RIVET_TS_DEPENDENCY` to the package version (S8). No cross-repo conformance test (N7).
- **T7.** `tests/setup.ts` is an empty stub yet wired in `vitest.config.ts:8`. `test:watch` is bare `vitest` while fixtures/tests import from `dist/` — watch mode silently tests stale compiled output.

---

## 8. Docs & samples

- **D1.** `docs/guides/local-now-server-later.md` "same handler surface / same client calls / same behavior" — false for error paths (H3/S5) and typed/array query params (H2).
- **D2.** `docs/guides/hono.md` omits that query values are first-value-only raw strings (H2) and the no-`group` multi-contract hazard (H4); "Classes are resolved per request" matches code but contradicts the stale test title (H8).
- **D3.** `docs/guides/vite-plugin.md` "watches contract changes during vite dev and regenerates" — true only after one successful generation (V2).
- **D4.** Stale `v0.9.1` pin in `docs/getting-started.md` and all three `samples/myapp` package.jsons (S8). `samples/myapp` is not in the root pnpm workspace and installs the GitHub tag — the in-repo "reference app" (README claims it's canonical scaffold output) never exercises the current source tree; drift is undetectable.
- **D5.** `docs/reference/cli.md` references `poc1/contracts.ts` (doesn't exist; `poc/` is empty and gitignored); doesn't note both bin names run the identical entrypoint.
- **D6.** `AGENTS.md` is 100% GitNexus boilerplate referencing uncommitted `.claude/skills/gitnexus/...` paths — no actual project guidance for agents cloning the repo. (`.orch/`, `.gitnexus/`, `poc/`, `CLAUDE.md` are local-only clutter, not committed.)
- The "in-browser" mechanism itself (no service worker, no fetch monkeypatch — the generated client's injectable `fetch` is swapped for `app.request` via `local.ts`/`ui/rivet-local.ts`) is sound and matches the docs; the weakness is purely the error-path divergence.

---

## Suggested fix priority

Ordered roughly by (impact × ease):

1. **P1** — `export type {` in `src/index.ts:28`. One word; unbreaks `import "rivet-ts"` without hono.
2. **N1/N2** — serialize `isOptional` (and make .NET's `ClientEmitter`/`OpenApiEmitter` honour `IsOptional` — add to the rivet repo's list alongside N3 `queryAuth` mapping).
3. **S3** — write `api.contract.json` in the scaffold emitter; the document is already passed in.
4. **N4** — method-aware `SuccessStatus` in `runtime-types.ts`.
5. **S1 + T2** — qualify handler export names by contract; add `tsc` over scaffold output to the lifecycle test (catches S1, S3, S7 classes of bug permanently).
6. **S2** — resolve `typeArgs` through outer substitutions in `mock-value-generator.ts`.
7. **H1/H2/H3** — Hono binding honesty: type GET `input` as query, `req.queries()` + coercion/validation for typed params, try/catch body parse → 400. Pair with removing the scaffolded `onError` rethrow (S5).
8. **X1/X2** — `getText(node.getSourceFile())` everywhere + substitute (or reject) generic spec aliases.
9. **X5** — walk heritage clauses (mirror of .NET A3; fix the same way in both repos).
10. **X3/X4/X7** — route-param fallback in the explicit/input branches + diagnostics for discarded `params:`/`query:` shapes + multipart handling in `buildExplicitEndpointParams`; add the missing fixtures (T5).
11. **N7/T6** — cross-repo conformance test in CI (schema-validate output; run .NET `--from` over goldens; pin `DEFAULT_RIVET_TS_DEPENDENCY` to the package version).
12. **X13** — the big one when time allows: collapse frontend/lowerer into a single pass (kills the duplication, the double type-check, V3/C4, and the divergence class of bugs for good).
