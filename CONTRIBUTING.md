# Contributing

## Setup and the gate

```bash
pnpm install        # also builds dist/ (prepare)
pnpm build && pnpm check && pnpm lint && pnpm fmt:check && pnpm test
```

`pnpm test` builds first: the scaffold, scaffold-mock, Vite and pack tests resolve the bare `rivet-ts` import to this repo's `dist/`. `pnpm test:watch` builds once, then keeps `dist/` current with `tsc --watch` while Vitest watches.

`*.test-d.ts` files are type tests: Vitest runs them through `tsc` (`typecheck` in `vitest.config.ts`), and `pnpm check` compiles them too.

## External tools the tests use

- **Rivet.** `tests/integration/rivet-tool-from.lifecycle.test.ts` runs every lowerable fixture through the pinned Rivet release (`DEFAULT_RIVET_VERSION` in `src/config/rivet-binary.ts`, or `RIVET_VERSION`). The first run downloads the release into the rivet-ts cache, exactly as `rivet-ts rivet` does. It also checks that `tests/rivet-contract-schema.json` equals the schema at that release's tag, so it needs network access. When you move the pin, re-vendor the schema from the new tag.
- **Plumb.** The scaffold suite runs Plumb on fresh scaffolds when `PLUMB` points at the executable or `plumb` is on `PATH` (a shell alias is not). Without it, those tests are reported as skipped, with the reason. A `PLUMB` that does not exist fails the run.

## Why some runtime-looking packages are devDependencies

`zod`, `dexie`, `typed-inject` and `@hono/node-server` are not used by rivet-ts itself. They are devDependencies for two reasons:

1. The scaffolds pin these packages to the versions in this `package.json` (`PINNED_PACKAGE_SECTIONS` in `src/infrastructure/scaffold/workspace-emitter.ts`, which fails if a pin is missing). Bumping one here bumps what `rivet-ts scaffold` and `scaffold-mock` emit.
2. The scaffold tests type-check and run the emitted workspace offline by linking this repo's `node_modules` into it (`tests/support/scaffold-oracles.ts`). So every package a scaffold imports must be installed here.

## GitNexus

GitNexus is not a dependency. Run `pnpm analyze` (`npx gitnexus analyze`) to index the repo. In a second worktree, pass `--name <alias>` so the registry entry does not collide with the main checkout.
