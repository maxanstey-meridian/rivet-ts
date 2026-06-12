# rivet-ts — agent guidance

TypeScript contract extractor + Hono runtime + scaffolder for Rivet. The .NET
binary (`Rivet.Tool --from`) is the sole OpenAPI emitter; this package lowers
TS contracts to contract JSON, serves them via `rivet-ts/hono`, and scaffolds
golden-shape workspaces (`rivet-ts scaffold` / `scaffold-mock`).

- Build before testing: `pnpm test` (= `pnpm build && vitest run`). Tests
  import `dist/` in places; a stale build means stale tests.
- Finish line: `pnpm lint && pnpm check && pnpm test`.
- The scaffold lifecycle suite enforces ZERO plumb findings on fresh scaffold
  output (`~/.meridian/plumb/plumb`; self-skips if absent). Any change to the
  emitters in `src/infrastructure/scaffold/` must keep that gate green — the
  scaffolder is permanently coupled to Meridian doctrine.
- Reviews/registers: `~/Sites/medway/rivet/FABLE_GAPS.md` (cross-repo
  capability register, audit snapshot) and `~/Sites/medway/rivet/HANDOVER.md`
  (current state: done/decided/deferred). The 2026-06-10 code review and the
  scaffolder plan shipped in full — git history keeps the retired docs.
- The version in package.json pins the scaffolded `rivet-ts` dependency
  (tested); bump it as part of every release tag.
