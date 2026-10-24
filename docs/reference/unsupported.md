# Unsupported Shapes

## TypeScript constructs that are out of scope

These shapes are not part of the contract system and should produce diagnostics rather than magical output:

- conditional types
- mapped types
- indexed access types
- general intersection types
- utility-wrapper object transforms such as `Readonly<T>`, `Partial<T>`, `Required<T>`, `Pick<T, ...>`, and `Omit<T, ...>`
- tuple DTO types; tuple syntax is supported for metadata arrays such as `errors`, `requestExamples`, and `responseExamples`
- function types
- `any`
- `never`
- standalone `null`; use `T | null`
- `Date` anywhere in a request (body, route, query or form field): it arrives as a string, so lowering reports `DATE_IN_REQUEST`; use `Format<string, "date-time">`
- `Format` over anything but a primitive, such as `Format<Date, "…">`: TypeScript rejects it, and lowering reports `UNSUPPORTED_FORMAT_TARGET` (a `Date` already lowers to a `date-time` string)
- non-literal or repeated tagged-union discriminator values
- enums that mix string and numeric members
- class-based or namespace-based contract authoring
- decorator-driven endpoint definitions

DTO/type-expression intersections are unsupported except the explicit utility types:

- `Brand<T, Name>`
- `Format<T, FormatName>`

Endpoint metadata authoring has separate helper-spec exceptions. Intersections with the public authoring helper specs, such as `EndpointAuthoringSpec`, `EndpointErrorAuthoringSpec`, and `EndpointSecurityAuthoringSpec`, are supported when they resolve to valid endpoint metadata.

Plain property-level `readonly` modifiers are supported. What is not supported is authoring contracts through generic utility wrappers that transform object shapes.

## Shapes that are reflected but not scaffolded cleanly yet

`scaffold-mock` is strongest on normal JSON APIs. These edges are not first-class today:

- anything that collapses to `unknown`
- recursive response types with no finite JSON value; nullable, optional-property, array, and dictionary recursion boundaries are synthesized
- behavior inferred from request semantics

The scaffold does not infer domain behavior such as “create echoes the body” or “toggle mutates state”.

Multipart and form-encoded endpoints are reflected and supported by the Hono runtime. `scaffold-mock` cannot mock a multipart (`acceptsFile: true`) endpoint's file and form-field params: its handler throws, and it prints one `SCAFFOLD_UNSUPPORTED_PARAM_SOURCE` warning per such param, as described below. You own the actual domain behavior.

## What happens on unsupported scaffold shapes

On unsupported scaffold shapes, the generator:

- still emits the project
- still emits the handler file
- writes a clear TODO comment
- throws from that handler instead of fabricating an invalid response

## Error-path generation

Contracts can absolutely describe error responses.

What is not automatic today is full mock error behavior. Scaffolded handlers are success-first — the one automatic error path is request-body validation: body-carrying endpoints reject invalid bodies with `422 { code: "validation_failed" }` through the emitted Zod schemas. Other error paths remain typed in the contract and generated client, but the mock scaffold does not try to simulate full domain error behavior for you.
