# Zero to API in 5 Minutes

Build a contract-first local app from scratch:

1. define a TypeScript contract
2. scaffold a Hono app around it
3. generate the separate client
4. call that client locally

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
pnpm run generate
```

The scaffold emits this shape:

```text
myapp/
├── generated/
├── index.html
├── package.json
├── src/
│   ├── api.ts
│   ├── contract-source/
│   │   └── contracts.ts
│   ├── contract.ts
│   ├── handlers/
│   │   ├── create-todo.ts
│   │   ├── get-todo.ts
│   │   └── list-todos.ts
│   ├── local-rivet.ts
│   └── main.ts
├── tsconfig.json
└── vite.config.ts
```

## 3. Inspect the generated handler shape

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

## 4. See how local transport is wired

Generated `src/local-rivet.ts`:

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

## 5. Call the generated client

```ts
import { configureLocalRivet } from "./src/local-rivet.js";
import { todo } from "./generated/rivet/client/index.js";

configureLocalRivet();

const all = await todo.listTodos();
const single = await todo.getTodo("1");
const created = await todo.createTodo({ title: "Prove the scaffold works" });
```

The generated project contains:

- a contract
- a local Hono app
- a generated client
- a fixed API surface

## 6. Run the app

```bash
pnpm run dev
```

The app runs in the browser runtime until it is exposed through a server entry.

## Next

- Read [Local Now, Bun Later](/guides/local-now-server-later)
- Read [OpenAPI and Validators](/guides/openapi-and-validators)
