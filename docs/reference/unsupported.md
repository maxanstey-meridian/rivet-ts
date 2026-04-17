# Unsupported Shapes

## TypeScript constructs that are out of scope

These shapes are not part of the contract system and should produce diagnostics rather than magical output:

- conditional types
- mapped types
- indexed access types
- general intersection types
- tuple types
- function types
- `any`
- `never`
- class-based or namespace-based contract authoring
- decorator-driven endpoint definitions

The only intentional intersection exceptions are the explicit utility types:

- `Brand<T, Name>`
- `Format<T, FormatName>`

## Shapes that are reflected but not scaffolded cleanly yet

`scaffold-mock` is strongest on normal JSON APIs. These edges are not first-class today:

- file responses
- multipart inputs
- form-field-heavy workflows
- anything that collapses to `unknown`
- recursive response types
- behavior inferred from request semantics

The scaffold does not infer domain behavior such as “create echoes the body” or “toggle mutates state”.

## What happens on unsupported scaffold shapes

On unsupported scaffold shapes, the generator:

- still emits the project
- still emits the handler file
- writes a clear TODO comment
- throws from that handler instead of fabricating an invalid response

## Error-path generation

Contracts can absolutely describe error responses.

What is not automatic today is full mock error behavior. Scaffolded handlers are success-first. Error paths remain typed in the contract and generated client, but the mock scaffold does not try to simulate full domain error behavior for you.
