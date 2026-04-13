<h1 align="center">rivet-ts</h1>
<p align="center">
  <a href="https://github.com/maxanstey-meridian/rivet-ts/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
</p>

**Define your API surface in type-only TypeScript, extract a Rivet contract, get OpenAPI, typed clients, and validators downstream.** No decorators, no runtime, no codegen config.

> [Rivet](https://github.com/maxanstey-meridian/rivet) gives you end-to-end type safety from .NET to TypeScript. rivet-ts lets you author that same contract natively in TypeScript — same pipeline, same outputs, TypeScript-first DX.

## Install

```bash
pnpm add -D github:maxanstey-meridian/rivet-ts
```

## Define contracts → get contract JSON

```ts
import type { Contract, Endpoint } from "rivet-ts";

export interface MemberDto {
  id: string;
  email: string;
  role: MemberRole;
}

export type MemberRole = "admin" | "member";
// or: export enum MemberRole { Admin = "admin", Member = "member" }

export interface CreateMemberRequest {
  email: string;
}

export interface ValidationErrorDto {
  message: string;
  fields: Record<string, string[]>;
}

export interface MembersContract extends Contract<"MembersContract"> {
  List: Endpoint<{
    method: "GET";
    route: "/api/members";
    response: MemberDto[];
    description: "List all members";
  }>;

  Create: Endpoint<{
    method: "POST";
    route: "/api/members";
    input: CreateMemberRequest;
    response: MemberDto;
    successStatus: 201;
    errors: [{ status: 422; response: ValidationErrorDto; description: "Validation failed" }];
    security: { scheme: "admin" };
  }>;
}
```

```bash
pnpm exec rivet-reflect-ts --entry ./contracts.ts --out ./contract.json
```

## Feed the contract to Rivet → get TypeScript + OpenAPI

```bash
# TypeScript types, typed client, OpenAPI spec
dotnet rivet --from contract.json --output ./generated --openapi openapi.json

# With security scheme definitions
dotnet rivet --from contract.json --output ./generated --openapi openapi.json \
  --security admin:bearer

# With Zod validators
dotnet rivet --from contract.json --output ./generated --compile

# JSON Schema only
dotnet rivet --from contract.json --output ./generated --jsonschema
```

Downstream Rivet emits the same artifacts it emits for C# sources: TypeScript types, typed clients, OpenAPI specs, JSON Schema, Zod validators, and generated C# DTOs.

## Add examples → get OpenAPI examples for Prism mocking

Author example data as plain `const` values, reference them with `typeof`:

```ts
export const createMemberRequest = {
  email: "ada@example.com",
} satisfies CreateMemberRequest;

export const memberResponse = {
  id: "mem_456",
  email: "ada@example.com",
  role: "member" as MemberRole,
} satisfies MemberDto;

export const validationError = {
  message: "Email is required",
  fields: { email: ["Required"] },
} satisfies ValidationErrorDto;

export interface MembersContract extends Contract<"MembersContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/members";
    input: CreateMemberRequest;
    response: MemberDto;
    successStatus: 201;
    errors: [{ status: 422; response: ValidationErrorDto; description: "Validation failed" }];
    requestExamples: [typeof createMemberRequest];
    responseExamples: [
      { status: 201; examples: [typeof memberResponse] },
      { status: 422; examples: [typeof validationError] },
    ];
  }>;
}
```

Examples flow through to OpenAPI `examples` blocks, which tools like [Prism](https://github.com/stoplightio/prism) serve as static mock responses:

```bash
pnpm exec rivet-reflect-ts --entry ./contracts.ts --out ./contract.json
dotnet rivet --from contract.json --openapi openapi.json --output ./generated
npx @stoplight/prism-cli mock openapi.json -h 127.0.0.1 -p 4010
```

## Endpoint options

Every endpoint is an `Endpoint<{ ... }>` type literal. These are the supported keys:

| Key                      | Type                                              | Required | Description                                                               |
| ------------------------ | ------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| `method`                 | `"GET" \| "POST" \| "PUT" \| "PATCH" \| "DELETE"` | Yes      | HTTP method                                                               |
| `route`                  | `string`                                          | Yes      | Route template, e.g. `"/api/members/{id}"`                                |
| `input`                  | type reference                                    |          | Request body (POST/PUT/PATCH) or query params (GET/DELETE)                |
| `response`               | type reference                                    |          | Success response body type. Omit or use `void` for no-content             |
| `successStatus`          | `number`                                          |          | Override default success status (200 GET/PUT/PATCH, 201 POST, 204 DELETE) |
| `errors`                 | tuple of error specs                              |          | Error responses with status codes and optional types                      |
| `summary`                | `string`                                          |          | Short endpoint summary                                                    |
| `description`            | `string`                                          |          | Long-form endpoint description                                            |
| `security`               | `{ scheme: string }`                              |          | Security scheme reference                                                 |
| `anonymous`              | `boolean`                                         |          | Mark endpoint as public (mutually exclusive with `security`)              |
| `fileResponse`           | `boolean`                                         |          | Response is a file download                                               |
| `fileContentType`        | `string`                                          |          | MIME type for file response (e.g. `"text/csv"`)                           |
| `formEncoded`            | `boolean`                                         |          | Request body is `application/x-www-form-urlencoded`                       |
| `acceptsFile`            | `boolean`                                         |          | Multipart file upload. Input must have exactly one `Blob`/`File` property |
| `requestExamples`        | tuple of example refs                             |          | Request body examples                                                     |
| `responseExamples`       | tuple of status-scoped specs                      |          | Response examples grouped by status code                                  |
| `requestExample`         | `typeof someConst`                                |          | Legacy singular sugar. Use `requestExamples`                              |
| `successResponseExample` | `typeof someConst`                                |          | Legacy singular sugar. Use `responseExamples`                             |

## Supported types

rivet-ts reflects TypeScript types into Rivet's intermediate contract format. The type system is intentionally narrow — it maps exactly what survives a JSON boundary.

### Type support matrix

| TypeScript construct                    | Rivet kind            | OpenAPI                | Notes                                                         |
| --------------------------------------- | --------------------- | ---------------------- | ------------------------------------------------------------- |
| `string`                                | `primitive`           | `string`               |                                                               |
| `number`                                | `primitive`           | `number`               |                                                               |
| `boolean`                               | `primitive`           | `boolean`              |                                                               |
| `unknown`                               | `primitive`           | `{}`                   | Escape hatch for truly dynamic data                           |
| `T[]` / `Array<T>` / `ReadonlyArray<T>` | `array`               | `array`                |                                                               |
| `Record<string, T>`                     | `dictionary`          | `additionalProperties` | String keys only                                              |
| `T \| null`                             | nullable wrapper      | `nullable: true`       |                                                               |
| `"a" \| "b" \| "c"`                     | `stringLiteralUnion`  | `enum`                 | Preferred form for string enums                               |
| `1 \| 2 \| 3`                           | `numericLiteralUnion` | `enum`                 | Numeric literal union types                                   |
| `enum E { A = "a" }`                    | `enum`                | `enum`                 | Also supported — produces identical output to string unions    |
| `interface Foo { ... }`                 | `ref` (+ type def)    | `$ref`                 | Exported interfaces become named schemas                      |
| `type Foo = { ... }`                    | `ref` (+ type def)    | `$ref`                 | Exported type aliases with object shapes                      |
| `Brand<string, "Email">`                | branded primitive     | `string`               | Nominal typing — emits `string & { __brand: "Email" }`        |
| `Format<string, "uuid">`                | primitive + format    | `string` + `format`    | Attaches format metadata (`uuid`, `date-time`, `email`, etc.) |
| Generic types                           | parameterised ref     | Resolved inline        | `Paginated<T>` → concrete `Paginated<MemberDto>`              |
| Optional properties (`?`)               | `optional: true`      | not in `required`      |                                                               |
| Readonly properties                     | preserved             | no effect              | Informational only                                            |
| Inline object types                     | `inlineObject`        | `object`               | Anonymous nested objects                                      |

### Not supported

These TypeScript constructs are explicitly out of scope. Using them in contract types produces diagnostics:

- Conditional types (`T extends U ? A : B`)
- Mapped types (`{ [K in keyof T]: ... }`)
- Indexed access types (`T["key"]`)
- Intersection types (`A & B`) — except `Brand` and `Format` utilities
- Tuple types
- Function types
- `any`, `never`, `void` as property types
- Namespace or class-based contracts
- Decorator-based endpoint authoring

## Example authoring

Examples must be exported `const` values with initializers. Use `satisfies` for type safety without widening.

### Supported AST constructs in examples

| Construct               | Example                         | Supported       |
| ----------------------- | ------------------------------- | --------------- |
| String literals         | `"hello"`                       | Yes             |
| Number literals         | `42`, `-3.14`                   | Yes             |
| Boolean literals        | `true`, `false`                 | Yes             |
| Null literal            | `null`                          | Yes             |
| Template literals       | `` `hello` ``                   | Yes             |
| Array literals          | `[1, 2, 3]`                     | Yes             |
| Object literals         | `{ key: "value" }`              | Yes             |
| Shorthand properties    | `{ x }` (where `x` is a const)  | Yes             |
| String concatenation    | `"a" + "b"`                     | Yes             |
| Identifier references   | `items: someOtherConst`         | Yes             |
| `satisfies` expressions | `value satisfies Type`          | Yes (unwrapped) |
| `as` expressions        | `value as Type`                 | Yes (unwrapped) |
| Prefix unary            | `-5`, `+3`                      | Yes             |
| Nested structures       | Objects and arrays at any depth | Yes             |
| Spread elements         | `{ ...other }`                  | No              |
| Function calls          | `buildTaxonomy("gb")`           | No              |
| Computed values         | `Date.now()`                    | No              |

### Example descriptor forms

Request and response examples support three forms:

```ts
// 1. Bare reference — inline JSON shorthand
requestExamples: [typeof myExample]

// 2. Inline descriptor — optional name and media type
requestExamples: [{ json: typeof myExample; name: "with admin role"; mediaType: "application/json" }]

// 3. Component-backed reference — preserves component ID in OpenAPI
requestExamples: [{
  componentExampleId: "CreateMember";
  resolvedJson: typeof myExample;
  name: "standard request";
}]
```

Response examples are grouped by status code:

```ts
responseExamples: [
  { status: 200; examples: [typeof successExample] },
  { status: 422; examples: [typeof validationError, typeof otherError] },
]
```

### Media type defaults

| Endpoint type        | Default request media type          | Default response media type  |
| -------------------- | ----------------------------------- | ---------------------------- |
| Standard JSON        | `application/json`                  | `application/json`           |
| `formEncoded: true`  | `application/x-www-form-urlencoded` | `application/json`           |
| `acceptsFile: true`  | `multipart/form-data`               | `application/json`           |
| `fileResponse: true` | —                                   | Endpoint's `fileContentType` |

## Type-safe handlers

rivet-ts exports handler types for implementing endpoints with compile-time enforcement:

```ts
import type { RivetHandler, ContractEndpointKey } from "rivet-ts";
import { handle } from "rivet-ts";
import type { MembersContract } from "./contracts.js";

// Option 1: Type annotation
const listMembers: RivetHandler<MembersContract, "List"> = async () => {
  return await db.members.findAll();
};

// Option 2: handle() helper
const createMember = handle<MembersContract, "Create">(async ({ body }) => {
  return await db.members.create(body);
});
```

## Local Runtime

rivet-ts includes a local contract runtime for direct in-process dispatch — no HTTP server, no network. Define handlers, create a client, and call endpoints as typed async functions. Contract and transport are separate concerns.

### Define handlers and create a client

```ts
import type { Contract, Endpoint } from "rivet-ts";
import { handle, defineHandlers, createDirectClient } from "rivet-ts";

interface AddRequest {
  a: number;
  b: number;
}
interface AddResponse {
  sum: number;
}

interface MathContract extends Contract<"MathContract"> {
  Add: Endpoint<{
    method: "POST";
    route: "/api/math/add";
    input: AddRequest;
    response: AddResponse;
  }>;
}

const handlers = defineHandlers<MathContract>()({
  Add: handle<MathContract, "Add">(async ({ body }) => ({
    sum: body.a + body.b,
  })),
});

const client = createDirectClient<MathContract>(handlers);

const result = await client.Add({ a: 1, b: 2 });
// result: { sum: 3 }
```

Client methods accept the DTO directly — `client.Add({ a: 1, b: 2 })`, not `client.Add({ body: { a: 1, b: 2 } })`. The client wraps input in `{ body }` internally.

### Result envelopes with `unwrap: false`

By default, client methods return the success DTO directly and throw `RivetError` on failure. Pass `{ unwrap: false }` to get a `{ status, data }` envelope instead:

```ts
import { RivetError } from "rivet-ts";

interface DivideRequest {
  a: number;
  b: number;
}
interface DivideResponse {
  quotient: number;
}
interface DivisionErrorDto {
  message: string;
}

interface CalcContract extends Contract<"CalcContract"> {
  Divide: Endpoint<{
    method: "POST";
    route: "/api/math/divide";
    input: DivideRequest;
    response: DivideResponse;
    errors: [{ status: 400; response: DivisionErrorDto }];
  }>;
}

// Default: returns DivideResponse or throws RivetError
const quotient = await client.Divide({ a: 10, b: 2 });

// unwrap: false — returns a discriminated union
const result = await client.Divide({ a: 10, b: 0 }, { unwrap: false });

if (result.status === 400) {
  // result.data is DivisionErrorDto
  console.error(result.data.message);
} else {
  // result.data is DivideResponse
  console.log(result.data.quotient);
}
```

For endpoints with no `errors`, `unwrap: false` returns the success result envelope only.

### Scope

The local runtime is for in-process dispatch — testing, scripting, or embedding contracts without a server. For HTTP clients, OpenAPI specs, validators, and generated code, feed the contract JSON to the downstream [Rivet](https://github.com/maxanstey-meridian/rivet) pipeline.

## CLI

```
rivet-reflect-ts --entry <path> [--out <file>]
```

| Flag      | Required | Description                                          |
| --------- | -------- | ---------------------------------------------------- |
| `--entry` | Yes      | TypeScript entry file containing contract interfaces |
| `--out`   |          | Output path for contract JSON. Defaults to stdout    |

Diagnostics are written to stderr. Unsupported constructs produce explicit error or warning diagnostics rather than silent fallbacks.

## Development

```bash
pnpm test          # run tests
pnpm build         # compile
pnpm run lint      # lint with oxlint
pnpm run fmt:check # format check with oxfmt
pnpm run check     # all of the above
```

## Related repos

- [Rivet](https://github.com/maxanstey-meridian/rivet) — .NET core: attributes, contracts, OpenAPI, client gen, validators
- [rivet-php](https://github.com/maxanstey-meridian/rivet-php) — PHP contract frontend

## License

MIT
