# Examples

Examples are used for:

- they flow through to downstream OpenAPI output
- `scaffold-mock` prefers them when generating happy-path stub handlers

## Author examples as exported const values

Use plain exported `const` values and `satisfies` so the example stays checked without widening.

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
```

## Reference them from the contract

```ts
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

## Request example forms

You can use:

1. bare references
2. inline descriptors
3. component-backed descriptors

```ts
requestExamples: [typeof createMemberRequest]

requestExamples: [{
  json: typeof createMemberRequest;
  name: "standard request";
  mediaType: "application/json";
}]

requestExamples: [{
  componentExampleId: "CreateMember";
  resolvedJson: typeof createMemberRequest;
  name: "component-backed request";
}]
```

## Response examples are status-scoped

```ts
responseExamples: [
  { status: 200; examples: [typeof successExample] },
  { status: 422; examples: [typeof validationError] },
]
```

Each response example status must match a declared success or error response. For a `422` example, declare a `422` entry in `errors`.

Legacy singular keys still exist:

- `requestExample`
- `successResponseExample`

They are normalized into the plural output shape. Do not declare both the singular and plural form on the same endpoint.

Default media types are derived from the endpoint shape:

- normal request examples use `application/json`
- `formEncoded: true` request examples use `application/x-www-form-urlencoded`
- `acceptsFile: true` request examples use `multipart/form-data`
- success examples on file-response endpoints default to `fileContentType`
- error response examples default to `application/json`

## Scaffold behavior

When `scaffold-mock` generates handlers, it prefers:

1. the first happy-path response example for the endpoint success status
2. deterministic synthesis from the response type
3. an explicit TODO-throwing stub if the shape is unsupported

Examples affect both generated OpenAPI output and scaffolded success responses.
