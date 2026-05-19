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
- inline object optional properties
- optional properties inside tagged-union variants
- non-literal or repeated tagged-union discriminator values
- mixed string and numeric literal unions
- enum declarations without explicit string or numeric literal initializers
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

- file response synthesis
- anything that collapses to `unknown`
- recursive response types
- behavior inferred from request semantics

The scaffold does not infer domain behavior such as “create echoes the body” or “toggle mutates state”.

Multipart and form-encoded endpoints are reflected and supported by the Hono runtime, but the scaffold still generates success-first handler stubs. You own the actual domain behavior.

## What happens on unsupported scaffold shapes

On unsupported scaffold shapes, the generator:

- still emits the project
- still emits the handler file
- writes a clear TODO comment
- throws from that handler instead of fabricating an invalid response

## Error-path generation

Contracts can absolutely describe error responses.

What is not automatic today is full mock error behavior. Scaffolded handlers are success-first. Error paths remain typed in the contract and generated client, but the mock scaffold does not try to simulate full domain error behavior for you.
