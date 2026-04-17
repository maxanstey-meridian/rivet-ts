# OpenAPI and Validators

`rivet-ts` does not emit OpenAPI itself. It reflects TypeScript contracts into Rivet contract JSON, then downstream Rivet turns that JSON into artifacts.

Responsibilities are split as follows:

- `rivet-ts` owns TypeScript authoring and scaffold workflow
- Rivet owns generated clients, OpenAPI, validators, schemas, and .NET-side interop

## Reflect the contract

```bash
pnpm exec rivet-reflect-ts --entry ./contracts.ts --out ./contract.json
```

## Generate OpenAPI and the client

```bash
dotnet rivet --from ./contract.json --output ./generated --openapi ./openapi.json
```

That emits:

- TypeScript DTOs
- a typed client
- Rivet runtime helpers
- an OpenAPI document

## Generate validators and schemas

Zod validators:

```bash
dotnet rivet --from ./contract.json --output ./generated --compile
```

JSON Schema:

```bash
dotnet rivet --from ./contract.json --output ./generated --jsonschema
```

Security schemes in OpenAPI:

```bash
dotnet rivet --from ./contract.json --output ./generated --openapi ./openapi.json \
  --security admin:bearer
```

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

- `rivet-ts` handles authoring and scaffolding
- Rivet handles generated clients, OpenAPI, validators, and schemas
