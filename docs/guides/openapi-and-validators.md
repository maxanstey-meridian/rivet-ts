# OpenAPI and Generated Clients

`rivet-ts` does not emit OpenAPI itself. It reflects TypeScript contracts into Rivet contract JSON, then downstream Rivet turns that JSON into a single artifact: an OpenAPI 3.1 document. Everything downstream of the spec — typed clients, docs UIs, mocks, validators — is the OpenAPI ecosystem's job.

Responsibilities are split as follows:

- `rivet-ts` owns TypeScript authoring, the scaffold workflow, and deriving the typed client from the spec
- Rivet owns OpenAPI emission and .NET-side interop

## Reflect the contract

```bash
pnpm exec rivet-reflect-ts --entry ./contracts.ts --out ./contract.json
```

## Generate OpenAPI

```bash
# Writes ./generated/openapi.json
dotnet rivet --from ./contract.json --output ./generated
```

`--openapi <path>` overrides the spec path (relative paths resolve against `--output`):

```bash
dotnet rivet --from ./contract.json --openapi ./openapi.json
```

Security schemes in OpenAPI:

```bash
dotnet rivet --from ./contract.json --output ./generated --security admin:bearer
```

## Generate the typed client

`rivet-ts generate` derives the client package from `openapi.json` in the generated root:

```bash
pnpm exec rivet-ts generate --generated-root ./generated
```

That emits:

- `schema.d.ts` — `openapi-typescript` types derived from the spec
- `index.ts` — a typed `openapi-fetch` client facade (`createClient`, `configureRivet`, `client`)

## Validation

Runtime request validation is the Hono adapter's job on the server: query/route coercion, missing-required and malformed-body checks, structured `400` responses.

If you also want client-side runtime validation, run [`openapi-zod-client`](https://github.com/astahmer/openapi-zod-client) over `openapi.json` — the binary no longer emits Zod validators or JSON Schema.

## Examples

Examples authored in the TypeScript contract flow through to downstream artifacts:

- OpenAPI `examples`
- scaffolded happy-path handlers

Example:

```ts
export const createMemberRequest = {
  email: "ada@example.com",
} satisfies CreateMemberRequest;

export const memberResponse = {
  id: "mem_456",
  email: "ada@example.com",
  role: "member" as MemberRole,
} satisfies MemberDto;

export interface MembersContract extends Contract<"MembersContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/members";
    input: CreateMemberRequest;
    response: MemberDto;
    successStatus: 201;
    requestExamples: [typeof createMemberRequest];
    responseExamples: [{ status: 201; examples: [typeof memberResponse] }];
  }>;
}
```

## Product boundary

- `rivet-ts` handles authoring, scaffolding, and the spec-derived client
- Rivet handles OpenAPI emission; the OpenAPI ecosystem handles everything else
