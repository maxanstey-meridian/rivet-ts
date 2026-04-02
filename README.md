# rivet-ts

TypeScript contract extractor for Rivet.

This package is intended to mirror the role of `rivet-php`:

- read a TS contract source program
- extract a Rivet-oriented intermediate contract shape
- emit JSON that `dotnet rivet` can consume downstream

The current scaffold establishes:

- layered source structure: `domain`, `application`, `interfaces`, `infrastructure`
- a thin type-only authoring surface via `Contract<T>` and `Endpoint<T>`
- a compiler-backed frontend using the TypeScript compiler API
- integration-style lifecycle tests that exercise real files and CLI flow

## Scripts

```bash
pnpm install
pnpm test
pnpm build
pnpm check
```

