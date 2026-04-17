<h1 align="center">rivet-ts</h1>
<p align="center">
  <a href="https://github.com/maxanstey-meridian/rivet-ts/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
</p>

**Contract-first APIs from TypeScript to working app, typed client, OpenAPI, and validators.** No decorators, no schema files, no codegen config.

> Write a TypeScript contract, scaffold a working Hono app, generate a separate client and OpenAPI downstream, and keep the same contract-first story if you later move to .NET with [Rivet](https://github.com/maxanstey-meridian/rivet).

## Install

```bash
pnpm add -D github:maxanstey-meridian/rivet-ts
```

## Write a contract

```ts
import type { Contract, Endpoint } from "rivet-ts";

export interface MemberDto {
  id: string;
  email: string;
  role: MemberRole;
}

export type MemberRole = "admin" | "member";

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

## Scaffold a working mock app

```bash
pnpm exec rivet-ts scaffold-mock --entry ./contracts.ts --out ./myapp
cd ./myapp
pnpm install
pnpm --dir packages/api run generate
pnpm run dev
```

`scaffold-mock` creates the project shape and authored source files. The API package `generate` step produces:

- `packages/api/generated/*.contract.json`
- `packages/api/generated/rivet/*`

After that initial generate, the Vite plugin keeps those artifacts current during `vite dev`.

The scaffold gives you:

- a root Vite app with `ui/` ready to run
- a Hono API package under `packages/api`
- plain async handlers, one per endpoint
- `configureLocalRivet()` for in-process local transport
- the Vite plugin already configured
- copied contract source so the scaffold is self-contained

For the `MembersContract` above, the current scaffold emits:

```text
myapp/
├── package.json
├── vite.config.ts
├── packages/
│   └── api/
│       ├── contracts.ts
│       ├── generated/          # created by `pnpm --dir packages/api run generate`
│       ├── package.json
│       └── src/
│           ├── api.ts
│           ├── contract.ts
│           ├── handlers/
│           │   ├── create.ts
│           │   └── list.ts
│           └── local-rivet.ts
└── ui/
    ├── index.html
    └── src/main.ts
```

Example emitted handler:

```ts
import type { RivetHandler } from "rivet-ts";
import type { MembersContract } from "../contract.js";

export const list: RivetHandler<MembersContract, "List"> = async () => {
  return [
    {
      "id": "example",
      "email": "example",
      "role": "admin"
    }
  ];
};
```

The intended path is:

1. write the contract
2. scaffold the whole local app
3. open `ui/src/main.ts` and start consuming `@api/generated/rivet/client`
4. replace stub handlers with real logic as needed
5. add a real server entry later if browser-runtime limits become a problem

## Reference app

This repository includes `samples/myapp` as the reference browser-local shape.

It was created by writing a TypeScript contract and running `scaffold-mock`.

That sample is the intended day-to-day structure after you follow the scaffold workflow:

```text
myapp/
├── package.json
├── vite.config.ts
├── packages/
│   └── api/
│       ├── contracts.ts
│       ├── generated/
│       ├── package.json
│       └── src/
└── ui/
    ├── index.html
    └── src/main.ts
```

The API package stays scaffold-shaped. The UI stays separate. The Vite plugin keeps the reflected contract, generated client, and `src/local-rivet.ts` current under `packages/api`.

## Generate a separate client, OpenAPI, and validators

First reflect your TypeScript contract to Rivet contract JSON:

```bash
pnpm exec rivet-reflect-ts --entry ./contracts.ts --out ./contract.json
```

Then feed that contract to downstream Rivet:

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

## Local now, server later

The scaffolded app starts in local mode. In `ui/src/main.ts`:

```ts
import { members } from "@api/generated/rivet/client/index.js";
import { configureLocalRivet } from "@api/src/local-rivet.js";

configureLocalRivet();

// Fully type-safe; runtime-safe when generated with --compile.
const created = await members.create({
  email: "ada@example.com",
});

console.log(created.id);
```

That lets the generated Rivet client call the Hono app in-process via `app.request(...)`.

With the Vite plugin in place, contract changes regenerate the local client/runtime artifacts during `vite dev`, so the frontend sees the updated client surface without a manual generate step.

When you want a real server, the happy path is almost a literal lift-and-shift:

1. keep the contract, handlers, and `packages/api/src/api.ts` as-is
2. add a real server entry that exposes `app.fetch`
3. deploy that Hono app somewhere real
4. stop using `configureLocalRivet()`
5. switch the UI to the normal generated Rivet runtime config

Example server entry:

```ts
import { app } from "./packages/api/src/api.js";

// Expose the same Hono app over HTTP so it can use real server-side concerns
// like databases, secrets, queues, and file storage without changing the
// contract, client shape, or handler surface.
Bun.serve({
  fetch: app.fetch,
});
```

Then point the generated client at the deployed API:

```ts
import { configureRivet } from "@api/generated/rivet/rivet.js";

configureRivet({ baseUrl: "https://api.example.com" });
```

The important distinction is:

- transport promotion is usually trivial
- infrastructure promotion is the real work

What changes at that point is not the contract or the generated client. What changes is everything the browser runtime could not provide cleanly:

- database access
- secrets and environment configuration
- auth and session verification
- background jobs
- file storage
- email and webhooks
- logging, monitoring, and rate limiting

So yes: if your handlers are already server-safe, promotion can be as simple as deploying the Hono app and replacing `configureLocalRivet()` with `configureRivet({ baseUrl })`.

## TS now, .NET later

If the project eventually needs to move to .NET, the story stays coherent:

- the contract-first workflow still applies
- downstream Rivet still owns the generated client/OpenAPI/validator pipeline
- the main [Rivet](https://github.com/maxanstey-meridian/rivet) repo covers the .NET server-side path

The important continuity is the client:

- your UI still calls the generated Rivet client
- your UI still configures that client with `configureRivet(...)`
- the main thing that changes is the `baseUrl`

In other words, the frontend does not need a new client model when the backend moves to .NET. It just stops pointing at the Hono app and starts pointing at the deployed .NET API.

## Add examples

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

Examples do two jobs:

- they flow through to OpenAPI `examples`
- `scaffold-mock` prefers them for happy-path stub responses before synthesizing fallback values

You can also use those examples with Prism:

```bash
pnpm exec rivet-reflect-ts --entry ./contracts.ts --out ./contract.json
dotnet rivet --from contract.json --openapi openapi.json --output ./generated
npx @stoplight/prism-cli mock openapi.json -h 127.0.0.1 -p 4010
```

## Type-safe handlers

You can type handlers directly against the contract surface:

```ts
import type { RivetHandler } from "rivet-ts";
import type { MembersContract } from "./contracts.js";

export const listMembers: RivetHandler<MembersContract, "List"> = async () => {
  return await db.members.findAll();
};

export const createMember: RivetHandler<MembersContract, "Create"> = async ({ body }) => {
  return await db.members.create(body);
};
```

To mount handlers onto Hono manually, use [`rivet-ts/hono`](./docs/guides/hono.md).

## Endpoint options

Every endpoint is an `Endpoint<{ ... }>` type literal. These are the supported keys:

| Key                      | Type                                              | Required | Description                                                               |
| ------------------------ | ------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| `method`                 | `"GET" \| "POST" \| "PUT" \| "PATCH" \| "DELETE"` | Yes      | HTTP method                                                               |
| `route`                  | `string`                                          | Yes      | Route template, e.g. `"/api/members/{id}"`                                |
| `input`                  | type reference                                    |          | Request body (POST/PUT/PATCH) or query params (GET/DELETE)                |
| `params`                 | type reference                                    |          | Explicit route params shape                                                |
| `query`                  | type reference                                    |          | Explicit query shape                                                       |
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
| `enum E { A = "a" }`                    | `enum`                | `enum`                 | Also supported — produces identical output to string unions   |
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

## CLI

```bash
rivet-reflect-ts --entry <path> [--out <file>]
rivet-ts scaffold-mock --entry <file> --out <dir> [--name <project-name>] [--tsconfig <file>]
```

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

- [Rivet](https://github.com/maxanstey-meridian/rivet) — .NET core: contracts, generated client, OpenAPI, validators
- [rivet-php](https://github.com/maxanstey-meridian/rivet-php) — PHP contract frontend

## License

MIT
