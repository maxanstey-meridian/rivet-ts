# Zero-Loss Corpus Plan

Replace the ratchet gate with a mandatory zero-loss corpus gate first, then treat every finding it emits as the implementation backlog until every corpus is clean.

No warnings-as-support, no baseline-encoded losses, no selective corpus, and no documented limitation counted as passing.

## Execution Contract

- Do not stop at green unit tests.
- Do not stop when findings decrease.
- Do not convert losses into warnings, diagnostics, markers, documentation, or baseline entries.
- A successful lossy import is a failing test.
- A genuinely unsupported construct must initially fail the command, not silently produce degraded output.
- The final objective is to implement those constructs so the corpus succeeds losslessly.
- Do not raise tolerated counts.
- Do not remove assertions, fixtures, corpus entries, or comparison categories.
- Do not add skips or environment-dependent self-skips.
- Do not call anything supported while its finding count is non-zero or its corpus is unexecuted.

## Definition Of Done

Every pinned corpus must satisfy all of these:

- Import command succeeds.
- Generated C# compiles.
- Re-emission succeeds without lossy diagnostics.
- Original operation count equals emitted operation count.
- Original and emitted operation sets are identical.
- Every path and method is accounted for.
- Every parameter is preserved in name, location, requiredness, type, format, enum, and default.
- Every request body is preserved in presence, requiredness, content types, schema, and encoding.
- Every response is preserved in status, content types, schema, headers, and examples where supported by the contract model.
- Security schemes and operation security requirements are preserved.
- Every original schema is accounted for.
- Every schema preserves type, composition, properties, requiredness, nullability, enums, formats, defaults, constraints, and `additionalProperties`.
- Comparator findings are empty.
- Tool warnings indicating degradation are empty.
- The same mandatory suite runs in CI.
- rivet-ts's TS -> contract JSON -> Rivet -> OpenAPI path runs against the real Rivet tool in CI.

Completion means zero unexplained findings across every corpus, not "no regression from yesterday."

## Phase 1: Fix The Gate

1. Create a committed corpus manifest containing every supported corpus.
2. Record source, version, SHA-256, OpenAPI version, and expected operation/schema counts.
3. Make the test enumerate the manifest rather than hard-code GitHub.
4. Fail if a manifest corpus is unavailable.
5. Remove `Category=Local` exclusion from the release path.
6. Make CI acquire every corpus reproducibly.
7. Remove conditional skipping from the cross-repository rivet-ts test.
8. Make CI check out or install the exact pinned Rivet version required by rivet-ts.

The manifest must include every current local corpus, including GitHub, Discord, Stripe, Notion, Slack, Box, Asana, Bitbucket, CircleCI, DigitalOcean, Firebase, Okta, Petstore, SendGrid, Spotify, Square, Vercel, Zoom, and any others discovered under `openapi/`.

OpenAI must be added as a pinned corpus rather than treated as implicitly covered.

## Phase 2: Make The Comparator Complete

1. Give the comparator explicit exit semantics:
   - `0`: exact semantic match.
   - `1`: semantic findings exist.
   - `2`: comparator or input failure.
2. Fail on `only_orig` operations.
3. Fail on `only_reemit` operations.
4. Compare original and emitted total operation counts.
5. Compare path-level parameters as well as operation-level parameters.
6. Account for every original schema.
7. Fail on unmatched schemas instead of silently omitting them from property comparison.
8. Compare response headers.
9. Compare request-body encoding metadata.
10. Compare callbacks, links, discriminators, XML metadata, examples, and other modeled OpenAPI fields.
11. Ensure every human-readable finding is present in structured JSON.
12. Fail if stdout/stderr reports a degradation absent from structured findings.
13. Add self-tests proving the comparator catches one deliberate mutation for every compared field.

Semantically equivalent normalization is allowed only when the comparator proves equivalence. It cannot be dismissed through category suppression.

## Phase 3: Replace The Baseline Assertion

Delete the acceptance rule:

```text
current findings <= baseline findings
```

Replace it with:

```text
all finding categories are empty
unmatched operations are empty
unmatched schemas are empty
lossy diagnostics are empty
```

The historical baseline may remain as an audit artifact, but it must not determine pass/fail.

The first strict run must be committed as a deliberately red test suite. That red output becomes the work queue.

## Phase 4: Capture The Full Backlog

For every corpus, generate:

- Exact operation findings.
- Exact schema findings.
- Import diagnostics.
- Emit diagnostics.
- Compilation failures.
- Unmatched operations.
- Unmatched schemas.
- Comparator-internal omissions.

Group findings by root cause, not merely category count.

The initial GitHub backlog already includes:

- 104 operations with drift.
- 17 dropped request bodies.
- 3 invented request bodies.
- 20 request content-type changes.
- 9 dropped parameters.
- 25 invented parameters.
- 1 requiredness change.
- 1 request schema-kind change.
- 59 response content-type changes.
- 25 response schema-type changes.
- 20 invented statuses.
- 2,261 nullable overclaims.
- 18 lost nullabilities.
- 282 enum changes.
- 660 numeric/URI format changes.
- 9 lost defaults.
- 26 lost `additionalProperties` declarations.
- 5 schema-kind changes.
- 65 schemas not currently assessed.

Running all corpora will expand this backlog. Nothing discovered is deferred merely because it is large.

## Phase 5: Fix Operation Fidelity

Work root-cause-first with a red-green loop.

1. Preserve GET and DELETE request bodies rather than relocating them into query parameters.
2. Represent request bodies independently from route/query parameters.
3. Preserve combined body, path, header, and query inputs without dropping either side.
4. Preserve body requiredness independently from input-record requiredness.
5. Preserve every request content type.
6. Preserve form, multipart, binary, text, and structured JSON body semantics.
7. Stop inventing request bodies from query parameters.
8. Stop inventing query parameters from body properties.
9. Preserve every response content type.
10. Preserve every declared status without adding undeclared alternatives.
11. Preserve response schema shape for every status/content-type pair.
12. Preserve security and authentication semantics.

After each root-cause fix:

- Run focused unit and round-trip tests.
- Run the entire corpus suite.
- Confirm no category increased anywhere.
- Treat newly exposed findings as backlog, not acceptable fallout.

## Phase 6: Fix Schema Fidelity

1. Preserve requiredness independently from nullability.
2. Preserve explicit nullable and non-nullable states.
3. Stop making all optional properties nullable.
4. Preserve scalar and heterogeneous unions.
5. Preserve `oneOf`, `anyOf`, and `allOf` semantics.
6. Preserve discriminators and mappings.
7. Preserve enums, including nullable enums.
8. Preserve numeric and string formats exactly.
9. Preserve defaults.
10. Preserve `additionalProperties: true`, `false`, and schema-valued forms.
11. Preserve arrays, tuples, dictionaries, and nested compositions.
12. Preserve constraints such as minimum, maximum, lengths, patterns, and item counts.
13. Preserve recursive and mutually recursive schemas.
14. Replace `JsonElement` degradation with an actual faithful representation.
15. Ensure every component is traceable through import and re-emission.

A `RIV2005` warning with successful degraded output remains a failing corpus test. It is not an accepted implementation.

## Phase 7: Run Every Corpus Continuously

After the gate exists, every implementation batch runs:

```text
focused tests
full Rivet suite
all corpus round trips
rivet-ts full suite
real rivet-ts -> Rivet.Tool interoperability
```

Do not reserve the all-corpus run for the end.

Maintain a generated matrix:

| Corpus | Operations | Schemas | Import | Compile | Re-emit | Findings |
|---|---:|---:|---|---|---|---:|

The matrix is derived from test output. It cannot be manually marked green.

## Phase 8: Harden rivet-ts

1. Remove the conditional .NET test skip.
2. Run against the exact built Rivet tool.
3. Expand beyond the current smoke fixture.
4. Feed representative constructs from every resolved root cause through TS lowering.
5. Compare final OpenAPI semantically, not through selected assertions.
6. Fail on any tolerated stderr warning.
7. Exercise scaffolded output through build, typecheck, runtime registration, and OpenAPI emission.
8. Ensure the vendored contract schema matches Rivet's source schema exactly.

## Phase 9: CI Enforcement

Required CI jobs:

- Rivet unit/integration suite.
- Every corpus round-trip.
- Comparator mutation/self-tests.
- Generated C# compilation.
- rivet-ts lint/typecheck/tests.
- Real cross-repository interoperability.
- Scaffold lifecycle.
- Zero Plumb findings.

No job may self-skip because a local dependency is absent. CI must provision it.

Release workflows must depend on these jobs. A tag cannot publish if any corpus has one finding.

## Phase 10: Final Audit

Before claiming completion:

1. Run every corpus from a clean checkout.
2. Run with fresh tool builds and no stale generated files.
3. Confirm all manifest hashes.
4. Confirm zero findings for every corpus.
5. Confirm zero lossy diagnostics.
6. Mutate one operation and verify the gate fails.
7. Mutate one request body and verify the gate fails.
8. Mutate one response and verify the gate fails.
9. Mutate one schema property and verify the gate fails.
10. Remove one corpus and verify the gate fails.
11. Remove the Rivet tool from rivet-ts CI and verify setup fails rather than skipping.
12. Publish the generated evidence matrix.

## Non-Negotiable Reporting

Every progress report must begin with:

```text
Corpora passing losslessly: X/Y
Total remaining operation findings: N
Total remaining schema findings: N
Unmatched operations: N
Unmatched schemas: N
Lossy diagnostics: N
CI skips: N
```

Then list exact root causes still open.

No confidence percentage while any value is non-zero. No "complete," "supported," or "green" based solely on unit-test totals.

This work continues until the matrix is entirely zero.
