# Supported Shapes

`rivet-ts` is intentionally narrow. It supports what can be represented cleanly across a network boundary and scaffolded into a believable local app.

## Endpoint authoring surface

Every endpoint is an `Endpoint<{ ... }>` type literal.

Supported keys:

| Key | Description |
| --- | --- |
| `method` | HTTP method |
| `route` | Route template, for example `"/api/members/{id}"` |
| `input` | Request body type |
| `params` | Explicit route params shape |
| `query` | Explicit query params shape |
| `response` | Success response type |
| `successStatus` | Success status override |
| `errors` | Error response tuple |
| `summary` | Short summary |
| `description` | Long description |
| `security` | Security scheme reference |
| `anonymous` | Public endpoint marker |
| `fileResponse` | File download response metadata |
| `fileContentType` | File MIME type |
| `formEncoded` | `application/x-www-form-urlencoded` input |
| `acceptsFile` | Multipart upload marker |
| `requestExamples` | Request example tuple |
| `responseExamples` | Response example tuple |

Legacy singular example keys also still exist:

- `requestExample`
- `successResponseExample`

## Type support matrix

| TypeScript construct | Notes |
| --- | --- |
| `string`, `number`, `boolean` | Primitive JSON-compatible values |
| `unknown` | Escape hatch for dynamic data |
| `T[]`, `Array<T>`, `ReadonlyArray<T>` | Arrays |
| `Record<string, T>` | Dictionaries with string keys |
| `T \| null` | Nullable wrapper |
| `"a" \| "b"` | String literal unions |
| `1 \| 2 \| 3` | Numeric literal unions |
| `enum E { ... }` | Emits as enum-compatible output |
| exported interfaces and object type aliases | Become named schemas/refs |
| inline object types | Supported as anonymous object shapes |
| `Brand<string, "Email">` | Branded primitives |
| `Format<string, "uuid">` | Primitive plus format metadata |
| generic types | Concrete substitutions are lowered |
| optional properties | Preserved |
| readonly properties | Preserved as type information |

## Happy-path scaffold support

`scaffold-mock` currently handles most normal JSON API success shapes:

- plain object DTOs
- inline objects
- arrays
- dictionaries
- nullable shapes
- string and numeric unions
- enum refs
- brands via underlying primitive types
- generics with actual type substitution
- tagged unions
- `void` and `204` success responses
- route params, query params, and JSON body inputs in handler signatures

## Runtime integration support

The current local runtime shape is:

- Hono transport via [`rivet-ts/hono`](/guides/hono)
- generated Rivet client
- in-process dispatch via `configureLocalRivet()`
- later Bun or other Hono-compatible server entry

That is the default path the docs assume.
