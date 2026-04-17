# Getting Started

1. install `rivet-ts`
2. write a TypeScript contract
3. scaffold the full app
4. run `pnpm install`
5. open `ui/src/main.ts` and start consuming the generated client

## 1. Install

```bash
pnpm add -D github:maxanstey-meridian/rivet-ts#v0.8
```

The browser-local flow does not require a separate `dotnet` install. The scaffolded Vite plugin downloads a pinned Rivet binary automatically when it needs one.

## 2. Write a contract

Create `contracts.ts`:

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
  }>;
}
```

## 3. Scaffold the full app

```bash
pnpm exec rivet-ts scaffold-mock --entry ./contracts.ts --out ./myapp
cd ./myapp
pnpm install
pnpm --dir packages/api run generate
```

This creates the default browser-local app shape and then generates the initial local artifacts:

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
│           ├── api.ts
│           ├── contract.ts
│           ├── handlers/
│           └── local-rivet.ts
└── ui/
    ├── index.html
    └── src/main.ts
```

The scaffold already includes:

- the API package under `packages/api`
- the root Vite config with `rivet-ts/vite`
- the `ui/` root
- an initial `ui/src/main.ts` that configures local transport and consumes the generated client when possible

Important:

- `scaffold-mock` creates the project shape and authored handlers
- `pnpm --dir packages/api run generate` produces `packages/api/generated/*.contract.json` and `packages/api/generated/rivet/*`
- once those initial artifacts exist, `vite dev` keeps them current

## 4. Start consuming from the UI

Open `ui/src/main.ts`.

Typical usage looks like this:

```ts
import { members } from "@api/generated/rivet/client/index.js";
import { configureLocalRivet } from "@api/src/local-rivet.js";

configureLocalRivet();

const all = await members.list();
console.log(all);
```

During `vite dev`, contract changes regenerate:

- `packages/api/generated/*.contract.json`
- `packages/api/generated/rivet/*`
- `packages/api/src/local-rivet.ts`

Vite then reloads the UI against the updated client surface.

## 5. Run the app

```bash
pnpm run dev
```

## Manual artifact generation

For OpenAPI, validators, JSON Schema, or non-plugin/manual flows:

```bash
dotnet tool install --global dotnet-rivet
pnpm exec rivet-reflect-ts --entry ./packages/api/contracts.ts --out ./contract.json
dotnet rivet --from ./contract.json --output ./generated --openapi ./openapi.json
```

## Next steps

- Read [Sample App](/guides/sample-app)
- Read [Vite Plugin](/guides/vite-plugin)
- Follow the [5 minute tutorial](/guides/tutorial)
- Read [Local Now, Bun Later](/guides/local-now-server-later)
- Read [OpenAPI and Validators](/guides/openapi-and-validators)
- Read [.NET Handoff](/guides/dotnet-handoff)
