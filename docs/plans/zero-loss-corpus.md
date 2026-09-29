# Zero-Loss Corpus Programme

Rivet's OpenAPI importer must preserve every supported contract fact through:

```text
source OpenAPI -> generated C# -> emitted OpenAPI -> second import/emission
```

rivet-ts must independently prove:

```text
TypeScript -> contract JSON -> pinned Rivet.Tool -> emitted OpenAPI
```

No warning, marker, baseline, documented limitation, or selective comparison counts as support. A construct is supported only when the applicable strict gate proves it losslessly.

## Current State

As of 2026-07-13:

```text
Corpora passing losslessly: 13/25
Total remaining operation findings: unknown until all 12 run through the strict gate
Total remaining schema findings: unknown until all 12 run through the strict gate
Unmatched operations: 0 across the verified thirteen; unknown globally
Unmatched schemas: 0 across the verified thirteen; unknown globally
Lossy diagnostics: 0 for valid constructs in the verified thirteen; unknown globally
CI skips: 4 known skip-capable rivet-ts gates; the Rivet corpus suite is absent from CI
```

The verified profile covers 1,599 of 8,675 manifest operations and 2,081 of 11,952 named schemas. The remaining 12 corpora contain 7,076 operations and 9,871 named schemas.

The physical corpus and retained audit artifacts are local and gitignored in `rivet`. The 13/25 result is therefore verified local evidence, not reproducible CI evidence.

### Verified Corpora

| Corpus      | Operations | Named schemas | Status                                              |
| ----------- | ---------: | ------------: | --------------------------------------------------- |
| Okta        |         19 |             0 | Verified clean                                      |
| Petstore v2 |         20 |             6 | Verified clean                                      |
| Petstore v3 |         19 |             6 | Verified clean                                      |
| Twilio      |        197 |           148 | Verified clean                                      |
| Square      |        200 |           807 | Verified clean                                      |
| DocuSign    |        393 |           565 | Verified clean                                      |
| Notion      |         13 |             0 | Verified clean with one classified source defect    |
| CircleCI    |         22 |            28 | Verified clean with one classified source defect    |
| Firebase    |         21 |            40 | Verified clean                                      |
| Docker      |        105 |            78 | Verified clean with one classified source defect    |
| SendGrid    |        334 |           145 | Verified clean with eight classified source defects |
| Spotify     |         89 |            93 | Verified clean                                      |
| Asana       |        167 |           165 | Verified clean                                      |
| **Total**   |  **1,599** |     **2,081** | **13/25**                                           |

The eleven source defects are exact, hash-bound classifications rather than tolerated valid-contract loss:

- Notion: a header parameter has an empty name.
- CircleCI: `Content-Type` is declared as a header parameter instead of through `requestBody.content`.
- Docker: `Content-Type` is declared as a header parameter instead of through `requestBody.content`.
- SendGrid: seven `Authorization` and one `Accept` reserved header parameters are declared as ordinary header parameters.

### Remaining Corpora

| Corpus       | Operations | Named schemas | Current classification                            |
| ------------ | ---------: | ------------: | ------------------------------------------------- |
| Bitbucket    |        303 |           194 | Wider mixed object/dictionary and link work       |
| Box          |        296 |           297 | Needs strict census                               |
| Cloudflare   |      2,700 |         5,565 | Broad operation and schema surface                |
| DigitalOcean |        290 |             0 | Needs strict census                               |
| Discord      |        229 |           499 | General union/const algebra                       |
| GitHub       |      1,099 |           916 | Broad union and mixed object/dictionary surface   |
| Jira         |        487 |           544 | Links, XML, and mixed object/dictionary work      |
| Kubernetes   |        248 |           251 | Needs strict census                               |
| Slack        |        174 |            48 | Union and mixed object/dictionary work            |
| Stripe       |        587 |         1,357 | General union/encoding algebra                    |
| Vercel       |        290 |            65 | General union and mixed object/dictionary algebra |
| Zoom         |        373 |           135 | Composition plus unsupported TRACE operations     |
| **Total**    |  **7,076** |     **9,871** | **12 remaining**                                  |

OpenAI is not in the current 25-corpus manifest. It must be acquired, pinned, hashed, inventoried, and added explicitly before it can increase the denominator; it is not implicitly covered.

## Execution Contract

- Do not stop at green unit tests or decreasing finding counts.
- A successful lossy import is a failing result.
- Do not convert loss into warnings, diagnostics, markers, documentation, source-defect entries, or baseline allowances.
- Source-defect classification is permitted only for an exact invalid source construct, bound to corpus hash, JSON pointer, reason, diagnostic, and cardinality.
- Do not raise tolerated counts, remove assertions, remove corpus entries, suppress comparison categories, or add environment-dependent skips.
- Do not call a construct or corpus supported while its valid finding count is non-zero or it has not executed.
- After every root-cause fix, run focused tests, the full Rivet suite, every currently verified corpus, and the candidate corpus.
- A corpus joins `verifiedCorpusIds` only after its complete first pass, fixed point, inventory, integrity, diagnostic, marker, and physical audit gates are green.

## Definition Of Done

Every pinned corpus must satisfy all of these:

- Import succeeds through the production CLI.
- Generated C# compiles through the loose-file path.
- Re-emission succeeds without lossy diagnostics or unsupported markers.
- Original and emitted operation counts and operation sets are identical.
- Every parameter preserves name, location, requiredness, schema, enum, format, default, style, and explode where applicable.
- Every request body preserves presence, requiredness, content types, schema, examples, and encoding.
- Every response preserves status, content types, schema, headers, examples, and links where applicable.
- Security schemes and operation security requirements are preserved.
- Every original component identity is accounted for, including unused and shared components.
- Every schema preserves type, composition, properties, requiredness, nullability, enums, formats, defaults, constraints, and `additionalProperties`.
- Every local reference resolves and every reviewed vendor extension has an explicit preserve, map, or exclude disposition.
- Comparator findings for valid constructs are empty.
- The second import/emission is a declared semantic fixed point.
- The same mandatory suite runs from a clean checkout in CI with reproducibly acquired corpus artifacts.
- rivet-ts runs its TypeScript-to-OpenAPI path against the exact pinned Rivet tool in CI without skips or tolerated warnings.

Completion means zero unexplained findings across every corpus, not "no regression from yesterday."

## Immediate Enabler: All-25 Census

Before claiming exact global remaining totals, run all 12 unverified corpora through the current production pipeline and retain the same artifacts as the verified gate:

- source hash and inventory;
- import stdout/stderr and generated C#;
- loose-file compilation;
- first emitted OpenAPI;
- structured comparator summary and details;
- unsupported-marker scan;
- integrity and component-identity checks;
- second import/emission and fixed-point comparison.

The census is reporting, not a baseline. Its findings remain failures and are grouped by root cause. It must not weaken the verified 13/25 gate or make unverified corpora appear supported.

## Completed Corpus Cohort

The agreed order is:

```text
Docker -> SendGrid -> Spotify -> Asana
```

All four are now admitted to the verified profile after exact first-pass comparison, loose-file compilation, fixed-point comparison, inventory/disposition review, and independent retained-artifact audit.

### 1. Docker

Verified result: 105 operations and 78 named schemas, with one exact `RIV3021` source defect. All valid finding categories and fixed-point findings are empty.

### 2. SendGrid

Verified result: 334 operations and 145 named schemas, with seven exact `RIV3022` and one exact `RIV3023` source defects. All valid finding categories and fixed-point findings are empty.

### 3. Spotify

Verified result: 89 operations and 93 named schemas with no source defects, warnings, markers, valid findings, or fixed-point findings.

### 4. Asana

Verified result: 167 operations and 165 named schemas with no source defects, warnings, markers, valid findings, or fixed-point findings.

## Later Corpus Tiers

### Strict Census Required

Box, DigitalOcean, and Kubernetes need current strict first-pass reports before they can be ranked honestly.

### Bounded but Wider

GitHub, Bitbucket, Jira, Zoom, and parts of Cloudflare contain non-algebra work worth separating from their hard remainder:

- response links and reusable linked components;
- XML metadata;
- TRACE and other operation-model gaps;
- status ranges and informational responses;
- request/response media and encoding metadata;
- mixed `properties` plus `additionalProperties` identities;
- document and description provenance.

Each root cause should be implemented and tested independently. Do not pull a whole corpus into the verified profile while any other valid finding remains.

### General Algebra Tier

Discord, Stripe, Vercel, Slack, and the algebra-heavy portions of Cloudflare and GitHub require broader representation work, including:

- unrestricted `oneOf`, `anyOf`, and `allOf` combinations;
- const unions and heterogeneous scalar leaves;
- mixed object/dictionary schemas;
- discriminators and mappings outside the current reversible shapes;
- recursive and mutually recursive algebra;
- schema-valued combinations that cannot currently become a faithful C# type.

This tier follows the Docker/SendGrid/Spotify/Asana cohort. It must not be approximated through `JsonElement`, warnings, or opaque fallback while claiming zero loss.

## Comparator Work

The comparator remains part of the product gate, not a reporting convenience. For every modeled field it must:

- return `0` for exact semantic match, `1` for findings, and `2` for comparator/input failure;
- compare operation counts and both missing and invented operations;
- compare path-level and operation-level parameters;
- account for every component and schema identity;
- compare request encoding, response headers, links, callbacks, discriminators, XML, examples, constraints, and composition where present;
- put every human-readable finding in structured JSON;
- fail if process output reports degradation absent from structured findings;
- have a mutation test proving every comparison category can fail.

Semantically equivalent normalization is allowed only when the comparator proves equivalence. It cannot be dismissed through category suppression.

## rivet-ts Interoperability Lane

The corpus programme belongs to Rivet's OpenAPI import/emission path. rivet-ts has a separate inverse obligation: representative TypeScript contracts must lower to contract JSON and produce the expected OpenAPI through the real Rivet tool.

Current state:

- `tests/integration/rivet-tool-from.lifecycle.test.ts` passes locally against the Rivet checkout;
- CI does not provision Rivet/.NET and `describe.skipIf` skips that test when the local project is absent;
- the test uses a machine-specific fallback project path;
- one multipart warning is tolerated;
- optional query requiredness and `queryAuth` assertions remain deliberately loose;
- the final OpenAPI is checked through selected assertions rather than the semantic comparator;
- three scaffold lifecycle checks return early when Plumb is absent;
- the downloadable Rivet binary default is pinned to `0.40.0` in code.

Required work:

1. Provision the exact pinned Rivet release and .NET SDK in CI.
2. Remove the local-path fallback and `describe.skipIf` from the interop gate.
3. Provision Plumb or otherwise make its three doctrine gates mandatory in CI.
4. Eliminate the tolerated multipart warning by preserving the required type definition.
5. Tighten optional query and `queryAuth` assertions through the final emitted OpenAPI.
6. Add representative TS fixtures for every resolved root-cause family that TS can author.
7. Compare the final OpenAPI semantically instead of relying only on selected assertions.
8. Exercise scaffolded output through build, typecheck, runtime registration, OpenAPI emission, and zero-Plumb validation.
9. Verify that rivet-ts's vendored contract schema exactly matches Rivet's source schema.

## CI Enforcement

Required CI jobs:

- Rivet unit and integration suite;
- every pinned corpus round trip;
- comparator mutation/self-tests;
- generated C# compilation;
- rivet-ts lint, typecheck, and tests;
- real rivet-ts-to-Rivet interoperability;
- scaffold lifecycle;
- zero Plumb findings.

No job may self-skip because a local dependency is absent. Release workflows must depend on these jobs. A tag cannot publish if any verified or required corpus has one valid finding.

Reproducible corpus acquisition is still unresolved. Before enabling the all-corpus CI job, each artifact needs an approved source, immutable version/hash, and acquisition mechanism. Unknown provenance must not be replaced by an invented URL.

## Final Audit

Before claiming complete corpus support:

1. Run every corpus from a clean checkout with fresh tool builds.
2. Confirm all manifest hashes and reviewed source-defect hashes.
3. Confirm zero valid findings, lossy diagnostics, and unsupported markers.
4. Confirm first-pass and fixed-point integrity.
5. Mutate one operation, parameter, request body, response, schema property, component identity, diagnostic, and corpus entry; prove each mutation fails.
6. Remove the Rivet tool and Plumb from rivet-ts CI setup; prove setup fails rather than tests skipping.
7. Publish the generated evidence matrix.

## Reporting Contract

Every progress report begins with:

```text
Corpora passing losslessly: X/Y
Total remaining operation findings: N or explicitly unknown
Total remaining schema findings: N or explicitly unknown
Unmatched operations: N or explicitly unknown
Unmatched schemas: N or explicitly unknown
Lossy diagnostics: N or explicitly unknown
CI skips: N
```

Then list exact open root causes. Unknown is required until the complete applicable matrix has run; estimated counts must not be presented as measured results.

No confidence percentage, "complete," "supported," or "green" claim is permitted while any required value is non-zero, unknown, skipped, or unexecuted.
