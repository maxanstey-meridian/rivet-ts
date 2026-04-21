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
│   ├── api/
│   │   ├── generated/
│   │   ├── package.json
│   │   └── src/
│   │       ├── app.ts
│   │       ├── app/
│   │       └── modules/
│   └── client/
│       ├── generated/
│       └── package.json
└── ui/
    ├── index.html
    ├── rivet-local.ts
    └── src/main.ts
```

The important boundary is that the UI consumes `@myapp/client`. Local browser transport is wired once in `ui/rivet-local.ts` through `@myapp/api/local`, and the UI does not reach into API source files or generated implementation paths directly.

## 3. Inspect the generated handler shape

`scaffold-mock` creates the authored source layer under `packages/api/src`.

`pnpm --dir packages/api run generate` creates:

- `packages/api/generated/api.contract.json`
- `packages/client/generated/rivet/*`
- `packages/client/generated/index.ts`

Example generated handler:

```ts
import type { RivetHandler } from "rivet-ts";
import type { TodoContract } from "#contract";

export const getTodo: RivetHandler<TodoContract, "GetTodo"> = async ({ params }) => {
  return {
    id: "example",
    title: "example",
    done: false,
  };
};
```

Replace those stubs with application logic as needed.

Example frontend consumption:

The scaffolded app starts in local mode. In `ui/src/main.ts`:

```ts
import { members } from "@myapp/client";
import { configureLocalRivet } from "../rivet-local";

configureLocalRivet();

// Fully type-safe; runtime-safe when generated with --compile.
const created = await members.create({
  body: {
    email: "ada@example.com",
  },
});

console.log(created.id);
```

That is the intended decoupling: write the UI against `@myapp/client`, and let `ui/rivet-local.ts` decide whether that surface is currently backed by local `app.request(...)` transport or a remote server.

## 4. Open the generated UI entrypoint

Generated `ui/src/main.ts`:

```ts
import { todo } from "@myapp/client";
import { configureLocalRivet } from "../rivet-local";

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
    "Open ui/src/main.ts and keep consuming @myapp/client.",
  ].join("\n");
};

void render();
```

This is the place to start consuming the API from the frontend.

## 5. See how local transport is wired

Generated `ui/rivet-local.ts`:

```ts
import { configureRivet, type RivetConfig } from "@myapp/client";
import { app } from "@myapp/api/local";
import { configureLocalRivet as configureRivetLocalRuntime } from "rivet-ts/local";

type LocalRivetConfig = Omit<RivetConfig, "fetch" | "baseUrl"> & {
  readonly baseUrl?: string;
};

export const configureLocalRivet = (config: LocalRivetConfig = {}): void => {
  configureRivetLocalRuntime({
    ...config,
    configureRivet,
    dispatch: (input, init) => app.request(input as string, init),
  });
};
```

The UI does not call `app.request(...)` directly. It calls `configureLocalRivet()` once and then uses the generated Rivet client.

That separation is deliberate. The frontend depends on the API surface, not the transport mechanics, so promotion to a real server later is a hosting/configuration change rather than a client rewrite.

## 6. Run the app

```bash
pnpm run dev
```

The app runs in the browser runtime until it is exposed through a server entry.

## Next

- Read [Local Now, Bun Later](/guides/local-now-server-later)
- Read [OpenAPI and Validators](/guides/openapi-and-validators)
