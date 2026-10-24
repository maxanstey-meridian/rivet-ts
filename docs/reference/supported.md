# Supported Shapes

`rivet-ts` is intentionally narrow. It supports what can be represented cleanly across a network boundary and scaffolded into a believable local app.

## Endpoint authoring surface

Every endpoint is an `Endpoint<...>` whose spec is a type literal or a type alias that resolves to one.

Supported keys:

| Key                | Description                                                           |
| ------------------ | --------------------------------------------------------------------- |
| `method`           | HTTP method                                                           |
| `route`            | Route template, for example `"/api/members/{id}"`                     |
| `input`            | Request body type                                                     |
| `params`           | Explicit route params shape                                           |
| `query`            | Explicit query params shape                                           |
| `response`         | Success response type                                                 |
| `successStatus`    | Success status override: a registered 2xx (200–208, 226)              |
| `errors`           | Error response array or tuple; a 2xx status is `INVALID_ERROR_STATUS` |
| `summary`          | Short summary                                                         |
| `description`      | Long description                                                      |
| `security`         | Security scheme reference                                             |
| `anonymous`        | Public endpoint marker                                                |
| `fileResponse`     | File download response metadata                                       |
| `fileContentType`  | File MIME type                                                        |
| `queryAuth`        | Query-string auth metadata, either `true` or a string token name      |
| `formEncoded`      | `application/x-www-form-urlencoded` input                             |
| `acceptsFile`      | Multipart upload marker                                               |
| `requestExamples`  | Request example array or tuple                                        |
| `responseExamples` | Response example array or tuple                                       |

Legacy singular example keys also still exist:

- `requestExample`
- `successResponseExample`

Endpoint metadata is authored as literal types. `method`, `route`, `summary`, `description`, `fileContentType`, `security.scheme`, and string `queryAuth` must be string literals; `successStatus` and error/example statuses must be numeric literals; boolean flags must be boolean literals.

Endpoint members may use identifier property names or string-literal property names. Computed and numeric endpoint names are not supported.

Parameter lowering has two modes:

- without explicit `params` or `query`, body methods (`POST`, `PUT`, `PATCH`) treat `input` as the body, while non-body methods split object-like `input` properties into route and query params
- with explicit `params` or `query`, those shapes define route/query params and `input` is still emitted as a body param if present

## Type support matrix

| TypeScript construct                        | Notes                                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `string`, `number`, `boolean`               | Primitive JSON-compatible values                                                                     |
| `unknown`                                   | Escape hatch for dynamic data                                                                        |
| `T[]`, `Array<T>`, `ReadonlyArray<T>`       | Arrays. `ReadonlyArray<T>` lowers as an array shape, not a stronger collection-mutability contract   |
| `Record<string, T>`                         | Dictionaries with string-like keys. Non-string-like record keys are rejected                         |
| `T \| null`                                 | Nullable wrapper                                                                                     |
| `"a" \| "b"`                                | String literal unions                                                                                |
| `1 \| 2 \| 3`                               | Numeric literal unions                                                                               |
| heterogeneous scalar unions                 | Primitive and scalar-literal variants, such as `number \| false`, lower to OpenAPI `oneOf` + `const` |
| discriminated object unions                 | Tagged unions when every variant has the same single required string-literal discriminator           |
| `enum E { ... }`                            | Auto-numbered and explicit string/numeric members are supported; mixed string/numeric enums reject   |
| exported interfaces and object type aliases | Become named schemas/refs                                                                            |
| inline object types                         | Supported as anonymous object shapes, including optional properties                                  |
| `Brand<string, "Email">`                    | Branded primitives; `brand("jane@example.com")` brands a value without validating it (mocks, tests)  |
| `Format<string, "uuid">`                    | Primitive plus format metadata; any value of the primitive is assignable, no cast needed             |
| `Date`                                      | `date-time` string on the wire. Responses only: a request reports `DATE_IN_REQUEST`                  |
| generic types                               | Contract JSON preserves generic refs and type arguments                                              |
| optional properties on named object shapes  | Preserved                                                                                            |
| plain `readonly` properties                 | Preserved as property-level type information                                                         |

Tagged-union discriminators must be required. Other variant properties may be optional.

Metadata arrays such as `errors`, `requestExamples`, and `responseExamples` support tuple syntax, readonly tuple syntax, `T[]`, `Array<T>`, `ReadonlyArray<T>`, and aliases that resolve to those forms. General tuple DTO shapes are not part of the supported DTO surface.

Multipart endpoints use `acceptsFile: true` and an object-like `input` with exactly one `Blob` or `File` property. Route-matching properties become route params, the file property becomes a file param, and other properties become form fields.

## Happy-path scaffold support

`scaffold-mock` currently handles most normal JSON API success shapes:

- plain object DTOs
- inline objects
- arrays
- dictionaries
- nullable shapes
- string and numeric unions
- enum refs (a TS `enum` as a member reference, `Status.Active`, imported from the copied contract module; a `declare enum` or one declared outside the contract sources gets a `// TODO:`)
- brands via underlying primitive types, wrapped in `brand(...)`
- generics with actual type substitution
- tagged unions
- `void` and `204` success responses
- route params, query params, and JSON body inputs in handler signatures
- form-encoded inputs

`unknown` can be reflected as a primitive escape hatch, but `scaffold-mock` does not synthesize a fake value for it.

Mock handlers return typed values with no type assertion, so they pass the scaffold's oxlint config (`typescript/consistent-type-assertions`). A success response example is checked against the response type first; one that does not match (a value outside its enum, a missing or extra property) is replaced by a synthesized value, with a `// TODO:` in the handler saying where it diverged and a warning on stderr naming that file.

## Runtime integration support

The current local runtime shape is:

- Hono transport via [`@maxanstey-meridian/rivet-ts/hono`](/guides/hono)
- a typed `openapi-fetch` client derived from the OpenAPI spec
- in-process dispatch wired once in the scaffolded UI plugin (`configureRivet({ fetch: (request) => app.request(request) })`)
- later a real server entry (`task api:run` uses `@hono/node-server`; any Hono-compatible runtime works)

That is the default path the docs assume.
