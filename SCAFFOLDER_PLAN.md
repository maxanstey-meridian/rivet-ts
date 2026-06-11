# SCAFFOLDER_PLAN — sorting out the rivet-ts scaffolder, then `meridian init`

Drafted 2026-06-11. Inputs: FABLE_REVIEW.md §3/§4 (2026-06-10), fix waves 1–4 +
Phase-5 rewrite (git log), `~/Sites/medway/rivet/FABLE_GAPS.md` §5.1 (2026-06-11,
verified at HEAD), `~/.meridian/plumb/FABLE_CONTRACT.md` §9 rulings (2026-06-11),
`~/Sites/golden` (branch rivet-v2) as the shape exemplar.

## Headline

The bug hunt is mostly done. S1/S2/S3/S8, P1, V1–V3, C1–C4 are fixed (waves 1–4);
the frontend/lowerer split (X13) is collapsed; the client is openapi-typescript +
openapi-fetch; the stale-spec silent-fallback was fixed at HEAD (`e1bd060`).

What remains splits into two distinct jobs the review could not have known about:

1. **Correctness residue** — a fresh scaffold still cannot pass its own gates
   (generate script exits 127; enum/`Format<>` mocks emit TS2322s; re-run clobbers
   user edits; entry must literally be `contracts.ts`).
2. **Doctrine drift** — the scaffolder emits a project that *plumb fails today*:
   - `*.use-case.ts` / tag-suffixed files → BT-003 (§9.1 v2: no type-tag suffixes;
     `<feature>.module.ts` sole exception — `.handler.ts` is not currently in the
     banned family but is the same disease; decide D1 below).
   - client facade `index.ts` emitted **inside** `packages/client/generated/` →
     RV-020 v2 (artifact dir may contain only `openapi.json` + `schema.d.ts`;
     facade lives in `src/` — golden's exemplar shape).
   - no oxlintrc / oxfmtrc / editorconfig / csharpier baselines → plumb v6 TO
     findings on day one.
   - no `.gitignore` (FABLE_GAPS 5.1) → `generated/` committed-then-stale.
   - workspace shape (`packages/api` + `packages/client`, vite-plugin pipeline)
     diverges from golden (`apps/api-ts` + `packages/contracts`, two-command
     Taskfile generation, `task plumb`).

**The keystone idea:** the scaffolder's acceptance gate becomes
`scaffold → tsc → vitest → plumb .` **all green, zero findings**, as a lifecycle
test in this repo. That permanently couples the generator to the doctrine: any
future plumb rule a fresh scaffold violates fails rivet-ts CI, so the scaffolder
can never drift from Meridian again. It is also exactly the gate `meridian init`
inherits for free.

---

## Phase 0 — triage at HEAD (half a day)

Re-verify which review-era findings are still open on branch `v2` (the fix waves
were against the review; GAPS re-checked some, not all). Known-open from reading
HEAD source today:

| Finding | Where | Status |
|---|---|---|
| `generate` script calls bare `rivet` → exit 127 | `mock-project-emitter.ts:800` | open (GAPS 5.1, P0) |
| enum / `Format<>` mocks emit raw literals → TS2322 fresh-scaffold typecheck fail | `mock-value-generator.ts` | open (GAPS 5.1, P0) |
| S4: entry hardcoded as `contracts.ts` (`"./contracts.js"` re-export + vite entry) | `mock-project-emitter.ts:327,514` | open |
| S6: re-run clobbers user edits, no `--force`; user file named `contract.ts` etc. clobbers emitted app files | emit loop + `run-cli.ts` flags | open |
| S7 residue: malformed stored example `JSON.parse` crash; dict-of-void `null` values | `mock-value-generator.ts` | verify |
| watchedFiles race + no debounce (double regen per save) | `vite.ts:209-224` | open (GAPS, minor) |
| B1/B2/B3: binaryPath rid throw; non-atomic binary install; integrity/proxy gaps | `rivet-binary.ts` | verify |
| T1: hardcoded `/Users/max/...` dotnet path, no skip guard | `rivet-tool-from.lifecycle.test.ts:14` | verify |
| no CI running the test suite at all | `.github/workflows/` | open (GAPS 5.1) |

Output: tick/cross this table, fold corrections into Phases 1–2.

## Phase 1 — a fresh scaffold passes its own gates (1–2 days)

Bugs only; no shape changes yet.

1. **Generate script**: never reference a bare `rivet` binary. Either route through
   `ensureRivetBinary` (expose a `rivet-ts rivet -- --from …` passthrough
   subcommand) or emit the script invoking the cached binary path the vite plugin
   already resolves. One source of truth for "where is the binary".
2. **Mock generator honesty**: enum-typed values emit a real member of the enum;
   `Format<…>` values emit a conformant literal (uuid/date-time/date/duration
   table); dictionary-of-void emits `{}` not `{key: null}`; wrap `parseExample`'s
   `JSON.parse` → diagnostic, not crash.
3. **S4**: derive the re-export + vite entry from `entryDependency` (already
   computed, currently unused) instead of hardcoding `contracts.ts`. Loud error if
   the entry lands outside `src/app/`.
4. **S6**: refuse to overwrite a non-empty `--out` without `--force`; reserve the
   emitted filenames (`contract.ts`, `composition.ts`, `local.ts`,
   `map-contract-error.ts`) against the copied-dependency set with a loud error.
5. **Vite plugin polish**: debounce regeneration; fix the `watchedFiles.clear()`
   race (collect into a fresh set, swap at the end).
6. **Binary bootstrap (B1/B2)**: lazy rid when `binaryPath` is explicit; extract to
   temp dir → verify → atomic rename.

Gate at end of phase: existing lifecycle tests + the scaffold-tsc gate green.

## Phase 2 — doctrine + golden-shape alignment (2–3 days, the real project)

Reshape the emitted project to be byte-for-byte the golden exemplar's idiom:

1. **No tag suffixes** (§9.1 v2): `application/add-thing.ts` not
   `add-thing.use-case.ts`; handler files named for the feature
   (`interface/http/<module>-routes.ts`, golden's pattern) rather than per-endpoint
   `.handler.ts` files. Export names already disambiguate (S1 aliasing stays).
2. **Facade out of generated** (RV-020 v2): emit `packages/contracts/` with
   `generated/{openapi.json, schema.d.ts}` + hand-owned `src/index.ts`
   (createClient/client/configureRivet) — the emitter writes `src/index.ts` once
   (scaffold-time only, it's user-owned thereafter), and `emitClientPackage`
   stops writing `index.ts` into the artifact dir.
3. **Workspace shape**: `apps/api` (TS backend) + `apps/ui` + `packages/contracts`,
   pnpm workspace, root Taskfile with `install/dev/generate/test/plumb` tasks —
   mirroring golden's Taskfile including `task plumb`.
4. **Golden configs**: emit `.oxlintrc.json`, `.oxfmt.json`(/oxfmtrc), root
   `.editorconfig` **sourced from `~/.meridian/plumb/configs/`** — single source of
   truth; the scaffold embeds copies at build time or reads the plumb dir when
   present (decide D3). Emit `.gitignore` covering `node_modules/`, `generated/`
   staleness is handled by regeneration not ignoring — actually: ignore nothing
   under `packages/contracts/generated/` (artifacts are committed per golden);
   ignore `dist/`, `.nuxt/`, OS noise.
5. **dependency-cruiser**: drop it (D2). plumb's BT-010/011/012 + module-boundary
   rules now cover every rule the emitted `.dependency-cruiser.cjs` enforces, and
   plumb is the one-stop-shop. `task plumb` replaces `check:architecture`.
6. **Results doctrine**: scaffolded TODO bodies stop `throw new Error(...)` for
   *declared* failure cases — declared failures are results (§9.3). Undeclared
   stays throw.
7. Pin the scaffolded rivet-ts dependency to the package version with a test (T6
   residue), and bump `DEFAULT_RIVET_VERSION` in lockstep with plumb's
   `SUPPORTED_RIVET` (same release act).

## Phase 3 — the gate (1 day)

- Lifecycle test: `scaffold-mock` a multi-contract fixture → `tsc --noEmit` →
  `vitest run` (if tests emitted) → `~/.meridian/plumb/plumb . --json` asserting
  **zero findings** (skip-guard if plumb absent, like the dotnet test should).
- Fix T1 (env-probe + `describe.skipIf` for the dotnet path) and add minimal CI
  (GitHub Actions: build + vitest; the plumb/dotnet legs skip in CI until wired).
- Update docs: getting-started reflects the new shape; delete the dead
  `poc1` reference (D5); replace AGENTS.md boilerplate.

## Phase 4 — `meridian init` (after the above; ~1 day of orchestration)

With Phases 1–3 done, init is thin composition, not a new codebase:

- **Home**: a small `meridian` CLI at `~/.meridian/bin/meridian` (plumb stays
  read-only forever — the no-fixer ruling in spirit; init writes, so it lives
  beside plumb, not inside it).
- **Behavior**: `meridian init <name> [--ts-backend] [--dotnet-backend] [--ui]`
  1. mkdir + git init + `.gitignore` + Taskfile + pnpm workspace + golden configs
     copied from `~/.meridian/plumb/configs/` (one source of truth — a repo born
     from init passes plumb v6 TO checks by construction).
  2. `--ts-backend` → shells out to `rivet-ts scaffold-mock` (or a new
     contract-less `rivet-ts scaffold` variant that emits the skeleton + one
     example module, no `--entry` required — small extraction once Phase 2 splits
     "skeleton emitter" from "contract-driven mock emitter"; that split falls out
     naturally from the Phase-2 reshaping).
  3. `--dotnet-backend` → v1: copy golden's `apps/api` shape as a template
     (`dotnet new` template extraction is a later nicety).
  4. Final step: run `plumb .` and print the (empty) report — init's own
     self-test, every time, on every machine.
- **Not in scope**: fixing existing repos (that's the refactor backlog), CI
  templates (deferred), interactive prompts.

## Decisions — SETTLED by Max 2026-06-11

- **D1: YES** — `.handler.ts` joins the BT-003 banned family. Encoded same day:
  contract §9.1 amended, MER-BT-003 extended, bad/good fixtures added
  (`get-quote.handler.ts` / `quotes-routes.ts`), prose synced. Calibration sweep
  found zero hits outside `samples/myapp` (scaffold output — this plan's target);
  golden's three `.use-case.ts` renames stay in the refactor backlog.
- **D2: YES** — drop dependency-cruiser from scaffold output; `task plumb`
  replaces `check:architecture`.
- **D3: two-step, package split** — extract a standalone **hono-scaffolder
  package** (doctrine-neutral: Hono + Rivet skeleton/mocks emitter, its own
  repo/workspace package, bug-hunted and refactored as its own project);
  rivet-ts delegates to it; then the **Meridian overlay** (golden configs,
  Taskfile incl. `task plumb`, naming, workspace shape) is applied on top —
  that overlay layer is what `meridian init` owns. This supersedes the
  embedded-vs-live framing: plumb's `configs/` are the overlay's source, and
  the overlay (not the scaffolder) carries the plumb-zero-findings gate.
- **D4: two commands** — `scaffold` (contract-less skeleton + example module,
  what init calls) and `scaffold-mock` (contract-driven mocks) stay separate.
- **D5: Nuxt** — scaffolded UI is golden's Nuxt app (SPA, `ssr:false`); the
  bare-vite mock page goes.

D3 reshapes Phase 2/4 slightly: Phase 2's "skeleton vs contract-driven" split
becomes the package boundary (hono-scaffolder = skeleton + mocks, no Meridian
opinions baked in), and the doctrine items (configs, Taskfile, no-suffix naming,
Nuxt UI, plumb gate) move into the overlay that rivet-ts's commands and
`meridian init` both apply. The plumb-zero-findings lifecycle test lives
wherever the overlay lives.

## Status — IMPLEMENTED 2026-06-11 (branch `scaffolder`)

All four phases shipped same-day:

- **Phase 0/1** — triage table actioned: generate-127 (rivet-ts `rivet --`
  passthrough via the cached binary), enum/`Format<>`/example mocks (format
  table + `needsCast` → `as <Output>`), S4 (entry-derived references), S6
  (`--force` + reserved-name guard), S7 (parseExample try/catch, `{}`
  dictionaries), H1 (method-aware input patterns), vite debounce + watch-set
  swap, B1 lazy rid, B2 atomic staged binary install.
- **Phase 2** — golden-shape emitters (`workspace-emitter.ts` shared by both
  commands): apps/api + apps/ui (Nuxt SPA, @nuxt/eslint) + packages/contracts
  (facade in `src/`, artifact dir = openapi.json + schema.d.ts only), Taskfile
  incl. `task plumb`, embedded plumb golden configs, suffix-free naming, no
  dependency-cruiser. `scaffold` (worked quotes example, entry lowered through
  the real pipeline) + `scaffold-mock` (contract-driven mocks). The D3 package
  split was implemented as a clean module boundary inside rivet-ts
  (`src/infrastructure/scaffold/`) rather than a separate repo — extraction to
  a standalone hono-scaffolder package is mechanical whenever wanted.
- **Phase 3** — gates live in `tests/integration/scaffold.lifecycle.test.ts`:
  shape → tsc (api + contracts) → runtime behavior (list/add/declared-409/
  structured-500) → **plumb zero findings** → embedded-configs-sync-with-plumb.
  scaffold-mock suite rewritten for the new shape (all S-intents preserved).
  CI workflow added (lint + check + test). Suite: 16 files / 177 tests green.
- **Phase 4** — `~/.meridian/bin/meridian` (`meridian init <dir> [--name]
  [--ts-backend] [--force]`): rivet-ts scaffold → git init + first commit →
  plumb self-test. Verified end-to-end (`/tmp/init-demo`, plumb 0/0/0).

**Flavors (2026-06-11, same day):** `meridian init` grew the backend selector —
`--ts-backend` (default, full Hono workspace), `--no-api` (Nuxt ui + contracts
only; `rivet-ts scaffold --no-api` underneath), and `--dotnet-backend`
(`--no-api` + golden's `apps/api`/`apps/api.tests` copied as a renamed template
+ `global.json` + plumb's canonical dotnet `.editorconfig` + CSharpier tool
manifest + a dotnet Taskfile mirroring golden's). Verified end-to-end: the
renamed .NET project builds with analyzers on and passes its tests; plumb
shows only the expected RV-026 version-lag warn (clears at Rivet 0.35).
Golden's api was fixed at source to satisfy its own analyzers (braces,
accessibility modifiers, csproj analyzer properties) — build + tests green.

**The release act:** version bumped to 0.11.0 (the v2 cutoff plumb RV-026
expects). Scaffolds pin `github:...#v0.11.0` — pushing that tag on merge is
what makes real (non-symlinked) installs resolve the new runtime.

## Proper-scaffold package (agreed 2026-06-11, building now)

Bread-and-butter pseudo-backend capabilities. Versions mirror casebridge
(zod ^4.3.6, @nuxt/ui ^4.5.1, nuxt ^4.3.1).

1. **Zod edge validation** — scaffold-time emitted, owned thereafter, locked
   with `satisfies z.ZodType<Input>` (drift = tsc error). Example module gets
   rich rules (`interface/validation/quotes.ts`); scaffold-mock synthesizes
   shape-level schemas from the IR (`zod-schema-emitter.ts`, body-carrying
   endpoints only; lock applied only when synthesis is exact). Routes
   safeParse → 422 `{code, message, errors}` (the golden ValidationFilter
   envelope), declared in the example contract. NOT a generate-pipeline
   artifact — the v2 types-only client decision is untouched (client-side
   validation remains opt-in openapi-zod-client).
2. **UI form reuse** — api package exports `"./validation"`; the example
   app.vue becomes a Nuxt UI `UForm :schema` page (the casebridge pattern):
   same schema validates the form and the server's front door.
3. **Dexie persistence** — `dexie-quote-store.ts` (versioned schema =
   migrations; populate event = seed). Forces the composition split: app.ts →
   `createApp(useCases, options)`; `local.ts` (browser) wires Dexie;
   `main.ts` (server) wires in-memory + logger + cors + serve.
4. **users module** — `UsersContract { Me: GET /api/me }` with a
   `current-user` port + stub adapter: gives identity a real home AND makes
   the example multi-module (two groups registered).
5. **logger/CORS** — hono/logger + hono/cors via createApp options, server
   entry only (the in-browser path needs neither — itself a teaching moment).
6. **Observability mini-ruling** — plumb contract §9 + backend-pa-vsa prose:
   edge-only logging, domain/application stay silent; no mechanical rule
   until an incident earns one.
7. **Gates** — lifecycle suites extended (422 path, validation export,
   Dexie presence, /api/me, plumb-zero, tsc, runtime); golden-meridian
   showcase regenerated.

Deferred deliberately: IR→Zod for the dotnet/no-api flavors (would emit only
shape checks — the TS contract carries no constraints; openapi-zod-client is
the documented opt-in). The interesting future version reads FluentValidation
rules into the contract's constraints channel first — its own project.

## Sequencing & sizing

Phase 0 → 1 → 2 → 3 strictly ordered (~5–7 working days of agent time);
Phase 4 anytime after. The N/H/X findings in FABLE_REVIEW that touch the
lowerer/runtime are **not** in this plan's scope unless Phase 0 shows a scaffold
gate tripping over one; the P0s in FABLE_GAPS §7 items 2–3 (dangling $refs,
importer param-drop) are .NET-side and tracked there.
