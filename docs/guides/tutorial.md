# Zero to API in 5 Minutes

Build a contract-first local app from scratch:

1. define a TypeScript contract
2. scaffold the full app around it
3. open the generated UI entrypoint
4. call the generated client locally

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

## 2. Scaffold the app

```bash
pnpm exec rivet-ts scaffold-mock --entry ./contracts.ts --out ./myapp
cd ./myapp
pnpm install
pnpm --dir packages/api run generate
```

The scaffold emits the project shape, and the API `generate` step produces the generated client/runtime artifacts:

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
│           │   ├── create-todo.ts
│           │   ├── get-todo.ts
│           │   └── list-todos.ts
│           └── local-rivet.ts
└── ui/
    ├── index.html
    └── src/main.ts
```

## 3. Inspect the generated handler shape

`scaffold-mock` creates the authored source layer under `packages/api/src`.

`pnpm --dir packages/api run generate` creates:

- `packages/api/generated/api.contract.json`
- `packages/api/generated/rivet/*`

Example generated handler:

```ts
import type { RivetHandler } from "rivet-ts";
import type { TodoContract } from "../contract.js";

export const getTodo: RivetHandler<TodoContract, "GetTodo"> = async ({ params }) => {
  return {
    id: "example",
    title: "example",
    done: false,
  };
};
```

Replace those stubs with application logic as needed.

## 4. Open the generated UI entrypoint

Generated `ui/src/main.ts`:

```ts
import { todo } from "@api/generated/rivet/client/index.js";
import { configureLocalRivet } from "@api/src/local-rivet.js";

const render = async (): Promise<void> => {
  configureLocalRivet();

  const output = document.getElementById("output");
  if (!output) {
    return;
  }

  const result = await todo.listTodos();

  output.textContent = [
    "todo.listTodos()",
    JSON.stringify(result, null, 2),
    "",
    "Open ui/src/main.ts and keep consuming @api/generated/rivet/client.",
  ].join("\n");
};

void render();
```

This is the place to start consuming the API from the frontend.

## 5. See how local transport is wired

Generated `packages/api/src/local-rivet.ts`:

```ts
import { app } from "./api.js";
import { configureRivet as configureGeneratedRivet, type RivetConfig } from "../generated/rivet/rivet.js";

type LocalRivetConfig = Omit<RivetConfig, "fetch" | "baseUrl"> & {
  readonly baseUrl?: string;
};

export const configureLocalRivet = (config: LocalRivetConfig = {}): void => {
  configureGeneratedRivet({
    ...config,
    baseUrl: config.baseUrl ?? "http://local",
    fetch: (input, init) => Promise.resolve(app.request(input as string, init)),
  });
};
```

The UI does not call `app.request(...)` directly. It calls `configureLocalRivet()` once and then uses the generated Rivet client.

## 6. Run the app

```bash
pnpm run dev
```

The app runs in the browser runtime until it is exposed through a server entry.

## Next

- Read [Local Now, Bun Later](/guides/local-now-server-later)
- Read [OpenAPI and Validators](/guides/openapi-and-validators)
