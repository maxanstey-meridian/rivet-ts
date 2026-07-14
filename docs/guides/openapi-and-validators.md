# OpenAPI and Generated Clients

`rivet-ts` does not emit OpenAPI itself. It reflects TypeScript contracts into contract JSON (an internal IR), then the version-pinned Rivet binary turns that JSON into a single public artifact: an OpenAPI 3.1 document. Everything downstream of the spec — typed clients, docs UIs, mocks, validators — is the OpenAPI ecosystem's job.

Responsibilities are split as follows:

- `rivet-ts` owns TypeScript authoring, the scaffold workflow, and deriving the typed client from the spec
- the Rivet binary owns OpenAPI emission (and .NET-side interop)

## Reflect the contract

```bash
pnpm exec rivet-ts --entry ./contracts.ts --out ./contract.json
```

## Generate OpenAPI

The `rivet-ts rivet --` passthrough resolves the cached binary (auto-installing the pinned version on first use) and forwards the arguments:

```bash
# Writes ./generated/openapi.json
pnpm exec rivet-ts rivet -- --from ./contract.json --output ./generated
```

`--openapi <path>` overrides the spec path (relative paths resolve against `--output`), and `--security <spec>` sets a default security scheme (e.g. `bearer`, `bearer:jwt`, `cookie:name`, `apikey:in:name`):

```bash
pnpm exec rivet-ts rivet -- --from ./contract.json --output ./generated --security admin:bearer
```

## Generate the typed client

`rivet-ts generate` derives the types from `openapi.json` in the generated root:

```bash
pnpm exec rivet-ts generate --generated-root ./generated
```

That emits `schema.d.ts` — `openapi-typescript` types derived from the spec. The `openapi-fetch` client facade is not generated here: it is emitted once at scaffold time into `packages/contracts/src/index.ts` and is hand-owned afterwards. The generated directory holds exactly `openapi.json` + `schema.d.ts` and stays read-only.

## Validation

Be explicit about what is enforced where:

- **Server, inbound — adapter**: the Hono adapter binds requests against the contract — missing required route/query params, number/boolean coercion failures, repeated single-valued query params, malformed JSON bodies, and missing multipart fields all produce structured `400 { code, message }` responses. The adapter itself never validates JSON body shape — that is the scaffolded schemas' job.
- **Server, inbound — body schemas**: scaffolded apps validate request body _shape_ at the edge through Zod schemas synthesized from the contract at scaffold time (`src/modules/<module>/<module>-validation.ts`) and owned by you afterwards. Violations produce a structured `422 { code: "validation_failed", errors }`. When the scaffold is given an OpenAPI spec (`scaffold-mock --spec <openapi.json>`), the spec's JSON Schema constraints — `minLength`/`maxLength`/`pattern`, `minimum`/`maximum`/exclusive bounds/`multipleOf`, `minItems`/`maxItems`/`uniqueItems` — are chained onto those schemas too, so DataAnnotations authored on the .NET side are enforced at the TypeScript edge. Without a spec there is no constraint source and the schemas carry shape only.
- **Server, outbound**: response bodies are not validated. Whatever the handler returns is serialized; extra fields go to the wire.
- **Client**: types-only by design. `openapi-typescript` + `openapi-fetch` give compile-time checking with no runtime validation layer.

If you want runtime validation beyond that, the spec is accurate input for any OpenAPI-ecosystem validator. Zod 4 ships first-party JSON Schema interop (`z.toJSONSchema` / `z.fromJSONSchema`) — the maintained ecosystem option for spec consumers — and [`openapi-zod-client`](https://github.com/astahmer/openapi-zod-client) generates clients over `openapi.json`. The binary itself no longer emits Zod validators or JSON Schema.

## Examples

Examples authored in the TypeScript contract flow through to downstream artifacts:

- OpenAPI `examples`
- scaffolded happy-path handlers

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
- the Rivet binary handles OpenAPI emission; the OpenAPI ecosystem handles everything else
