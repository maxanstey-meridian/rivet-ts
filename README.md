# rivet-ts

**Extract a Rivet contract JSON document from a constrained TypeScript contract DSL.**

Define your API surface in type-only TypeScript, run the extractor, get a JSON contract that
[Rivet](https://github.com/maxanstey-meridian/rivet) can turn into TypeScript clients, OpenAPI specs, JSON Schema,
and generated C# contracts downstream.

## Install

This repo is not published on npm yet. Install it directly from GitHub:

```bash
pnpm add -D github:maxanstey-meridian/rivet-ts
```

You can also pin a branch, tag, or commit:

```bash
pnpm add -D github:maxanstey-meridian/rivet-ts#main
pnpm add -D github:maxanstey-meridian/rivet-ts#v0.1.0
pnpm add -D github:maxanstey-meridian/rivet-ts#<commit>
```

After install, use the CLI from your consumer repo:

```bash
pnpm exec rivet-reflect-ts --entry ./contracts.ts --out ./contract.json
```

## Define TS contracts -> get a JSON contract

```ts
// contracts.ts
import type { Contract, Endpoint } from "rivet-ts";

export interface MemberDto {
  id: string;
  email: string;
}

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
    summary: "List members";
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

  Export: Endpoint<{
    method: "GET";
    route: "/api/members/export";
    fileResponse: true;
    fileContentType: "text/csv";
    summary: "Export members";
    description: "Download members as CSV";
    security: { scheme: "admin" };
  }>;
}
```

```bash
pnpm build
node ./dist/interfaces/cli/main.js --entry ./contracts.ts --out ./contract.json
```

```json
{
  "types": [
    {
      "name": "CreateMemberRequest",
      "typeParameters": [],
      "properties": [
        {
          "name": "email",
          "type": {
            "kind": "primitive",
            "type": "string"
          },
          "optional": false
        }
      ]
    },
    {
      "name": "MemberDto",
      "typeParameters": [],
      "properties": [
        {
          "name": "id",
          "type": {
            "kind": "primitive",
            "type": "string"
          },
          "optional": false
        },
        {
          "name": "email",
          "type": {
            "kind": "primitive",
            "type": "string"
          },
          "optional": false
        }
      ]
    },
    {
      "name": "ValidationErrorDto",
      "typeParameters": [],
      "properties": [
        {
          "name": "message",
          "type": {
            "kind": "primitive",
            "type": "string"
          },
          "optional": false
        },
        {
          "name": "fields",
          "type": {
            "kind": "dictionary",
            "value": {
              "kind": "array",
              "element": {
                "kind": "primitive",
                "type": "string"
              }
            }
          },
          "optional": false
        }
      ]
    }
  ],
  "enums": [],
  "endpoints": [
    {
      "name": "list",
      "httpMethod": "GET",
      "routeTemplate": "/api/members",
      "params": [],
      "controllerName": "members",
      "returnType": {
        "kind": "array",
        "element": {
          "kind": "ref",
          "name": "MemberDto"
        }
      },
      "responses": [
        {
          "statusCode": 200,
          "dataType": {
            "kind": "array",
            "element": {
              "kind": "ref",
              "name": "MemberDto"
            }
          }
        }
      ],
      "description": "List all members"
    },
    {
      "name": "create",
      "httpMethod": "POST",
      "routeTemplate": "/api/members",
      "params": [
        {
          "name": "body",
          "type": {
            "kind": "ref",
            "name": "CreateMemberRequest"
          },
          "source": "body"
        }
      ],
      "controllerName": "members",
      "returnType": {
        "kind": "ref",
        "name": "MemberDto"
      },
      "responses": [
        {
          "statusCode": 201,
          "dataType": {
            "kind": "ref",
            "name": "MemberDto"
          }
        },
        {
          "statusCode": 422,
          "dataType": {
            "kind": "ref",
            "name": "ValidationErrorDto"
          },
          "description": "Validation failed"
        }
      ],
      "security": {
        "isAnonymous": false,
        "scheme": "admin"
      }
    }
  ]
}
```

## Feed the contract to Rivet -> get TypeScript

Generate the contract JSON here, then hand it to the main Rivet tool:

```bash
dotnet rivet --from contract.json --output ./generated
```

Rivet will emit the same downstream artifacts it emits for C# and PHP sources:

- TypeScript types
- typed TS clients
- OpenAPI
- JSON Schema and optional Zod validators
- generated C# DTOs, enums, and contracts

## Feed the contract to Rivet -> get OpenAPI

```bash
dotnet rivet --from contract.json --openapi openapi.json --output ./generated
```

This package stops at the JSON contract seam. OpenAPI emission, client generation, validator generation, and C#
reconstruction remain downstream Rivet responsibilities.

## Current TS DSL

The supported authoring DSL is intentionally narrow and explicit:

```ts
export const listMembersResponseExample = {
  items: [{ id: "mem_123", email: "jane@example.com" }],
  totalCount: 1,
} satisfies PagedResult<MemberDto>;

export interface MembersContract extends Contract<"MembersContract"> {
  List: Endpoint<{
    method: "GET";
    route: "/api/members";
    response: MemberDto[];
    successResponseExample: typeof listMembersResponseExample;
    summary: "List members";
    description: "List all members";
  }>;
}
```

Supported today:

- `Contract<"...">`
- `Endpoint<{ ... }>`
- `EndpointAuthoringSpec`
- `EndpointErrorAuthoringSpec`
- `EndpointSecurityAuthoringSpec`

Supported endpoint keys today:

- `method`
- `route`
- `input`
- `response`
- `requestExample`
- `successResponseExample`
- `successStatus`
- `summary`
- `description`
- `errors`
- `anonymous`
- `security`
- `fileResponse`
- `fileContentType`

Notes:

- `EndpointAuthoringSpec`, `EndpointErrorAuthoringSpec`, and `EndpointSecurityAuthoringSpec` are exported so the supported surface is visible in autocomplete and type navigation.
- Endpoint specs are currently extracted from inline `Endpoint<{ ... }>` type literals.
- Examples must be authored as real exported `const` values and referenced from endpoint metadata with `typeof someExample`.
- Validate example values with `satisfies` against the DTO you want to model; the extractor serializes the const initializer, not an invented type-only example bag.
- The current scope is one `requestExample` and one `successResponseExample` per endpoint.
- In this slice, examples are preserved in the extracted frontend `ContractBundle` only. Downstream Rivet/OpenAPI emission is a later step.
- `errors` should be authored as an inline tuple of inline object literals.
- `security` should be authored as an inline object literal with a `scheme` property.
- exported `interface`, `type`, and `enum` declarations
- primitives, arrays, `Record<string, T>`, object types
- generic definitions and generic application
- string and numeric literal unions
- nullable `T | null`
- optional and readonly properties
- `Brand<T, "...">`
- `Format<T, "...">`
- endpoint metadata: `method`, `route`, `input`, `response`, `successStatus`, `summary`, `description`, `errors`,
  `anonymous`, `security`, `fileResponse`, `fileContentType`, `requestExample`, `successResponseExample`

Explicitly not the goal:

- arbitrary advanced TS metaprogramming
- conditional types
- mapped types
- indexed access tricks
- namespace/class/decorator-based authoring
- turning this package into a runtime framework or a wrapper around `dotnet rivet`

Unsupported constructs should produce explicit diagnostics rather than loose fallbacks.

## Development

```bash
pnpm test
pnpm build
pnpm run lint
pnpm run fmt:check
pnpm run check
```

## Related repos

- [Rivet core](https://github.com/maxanstey-meridian/rivet)
- [rivet-php](https://github.com/maxanstey-meridian/rivet-php)
