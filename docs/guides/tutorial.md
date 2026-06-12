# Zero to API in 5 Minutes

Build a contract-first workspace from scratch:

1. define a TypeScript contract
2. scaffold the workspace around it
3. run the dev loop
4. consume the typed client from the UI

## 1. Create a contract

Create `contracts.ts`:

```ts
import type { Contract, Endpoint } from "rivet-ts";

export interface TodoDto {
  id: string;
  title: string;
  done: boolean;
}

export interface ListTodosResponse {
  items: TodoDto[];
  totalCount: number;
}

export interface GetTodoParams {
  id: string;
}

export interface CreateTodoRequest {
  title: string;
}

export interface NotFoundDto {
  message: string;
}

export interface TodoContract extends Contract<"TodoContract"> {
  ListTodos: Endpoint<{
    method: "GET";
    route: "/todos";
    response: ListTodosResponse;
  }>;

  GetTodo: Endpoint<{
    method: "GET";
    route: "/todos/{id}";
    params: GetTodoParams;
    response: TodoDto;
    errors: [{ status: 404; response: NotFoundDto; description: "Todo not found" }];
  }>;

  CreateTodo: Endpoint<{
    method: "POST";
    route: "/todos";
    input: CreateTodoRequest;
    response: TodoDto;
    successStatus: 201;
  }>;
}
```

## 2. Scaffold the workspace

```bash
pnpm exec rivet-ts scaffold-mock --entry ./contracts.ts --out ./myapp
cd ./myapp
task install
```

The scaffold emits a pnpm workspace with bootstrap artifacts already in place:

```text
myapp/
├── Taskfile.yml
├── package.json / pnpm-workspace.yaml
├── .oxlintrc.json / .oxfmtrc.json / .editorconfig / .gitignore
├── apps/
│   ├── api/
│   │   ├── generated/api.contract.json      ← internal IR
│   │   ├── package.json / tsconfig.json
│   │   └── src/
│   │       ├── contracts.ts                 ← your entry, copied in
│   │       ├── app.ts / contract.ts / local.ts / main.ts
│   │       ├── interface/http/todo-routes.ts
│   │       ├── interface/validation/todo.ts ← user-owned Zod edge schemas
│   │       └── modules/todo/application/
│   │           ├── list-todos.ts
│   │           ├── get-todo.ts
│   │           └── create-todo.ts
│   └── ui/                                  ← Nuxt SPA (ssr: false)
│       ├── app/app.vue
│       └── app/plugins/rivet.client.ts      ← in-browser transport wiring
└── packages/contracts/
    ├── generated/openapi.json + schema.d.ts ← read-only
    └── src/index.ts                         ← hand-owned typed client facade
```

The UI consumes `@myapp/contracts` only; feature code never imports `apps/api/src/*` or generated internals directly.

## 3. Inspect a scaffolded handler

`scaffold-mock` synthesizes mock values from the contract (preferring authored examples when present):

```ts
import type { RivetHandlerInput, RivetHandlerResult } from "rivet-ts";
import type { TodoContract } from "#contract";

type GetTodoInput = RivetHandlerInput<TodoContract, "GetTodo">;
type GetTodoOutput = RivetHandlerResult<TodoContract, "GetTodo">;

export const getTodo = async (_input: GetTodoInput): Promise<GetTodoOutput> => {
  return {
    id: "example",
    title: "example",
    done: false,
  };
};
```

Replace those stubs with application logic as needed. Shapes the generator cannot synthesize get a TODO stub that throws rather than fabricating an invalid response.

Body-carrying endpoints (here `CreateTodo`) also get a Zod schema in
`interface/validation/todo.ts`, locked to the contract type with `satisfies`
and owned by you after emission. The route wrapper parses the body with it and
rejects violations with `422 { code: "validation_failed" }` before the handler
runs. Pass `scaffold-mock --spec <openapi.json>` to chain a generated spec's
JSON Schema constraints onto those schemas; without it they validate shape
only.

## 4. Consume the typed client

`apps/ui/app/app.vue` already demonstrates a call. The client is a typed `openapi-fetch` instance — it never throws on HTTP errors, so always handle `{ data, error }`:

```ts
import { client } from "@myapp/contracts";

const { data, error } = await client.POST("/todos", {
  body: { title: "Ship docs" },
});
```

## 5. See how local transport is wired

Scaffolded `apps/ui/app/plugins/rivet.client.ts`:

```ts
import { app } from "@myapp/api/local";
import { configureRivet } from "@myapp/contracts";

// Local-now: the whole API runs in the browser, dispatched through
// app.request. When you promote it to a real server (task api:run), swap
// the fetch dispatch for { baseUrl: "http://localhost:5180" }.
export default defineNuxtPlugin(() => {
  configureRivet({ fetch: (request) => app.request(request) });
});
```

The UI never calls `app.request(...)` directly — it configures the client once and uses the typed surface. Promotion to a real server is a one-line transport change, not a client rewrite.

## 6. Run the dev loop

```bash
task dev        # Nuxt frontend; the API runs in the browser
task generate   # after contract changes: entry → contract JSON → openapi.json → schema.d.ts
task api:run    # promote the API to a real server (port 5180)
task api:test   # typecheck + vitest
```

## Next

- Read [Local Now, Server Later](/guides/local-now-server-later)
- Read [OpenAPI and Generated Clients](/guides/openapi-and-validators)
