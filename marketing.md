# Rivet

One contract. One client. Start local, promote later.

---

### The contract

```ts
import type { Contract, Endpoint } from "rivet-ts";

export interface UserDto {
  id: string;
  name: string;
  email: string;
}

export interface GetUserParams {
  id: string;
}

export interface UserContract extends Contract<"UserContract"> {
  GetUser: Endpoint<{
    method: "GET";
    route: "/users/{id}";
    params: GetUserParams;
    response: UserDto;
  }>;
}
```

---

### The client

```ts
import { user } from "./generated/rivet/client/index.js";

const record = await user.getUser("usr_123");
console.log(record.name);
```

The client surface is the same the whole way through.

---

### 1. Scaffold locally

```ts
import type { RivetHandler } from "rivet-ts";
import type { UserContract } from "../contract.js";

export const getUser: RivetHandler<UserContract, "GetUser"> = async ({ params }) => {
  return {
    id: params.id,
    name: "Jane Doe",
    email: "jane@example.com",
  };
};
```

```ts
import { configureLocalRivet } from "./local-rivet.js";

configureLocalRivet();
```

No server process. No infra. The generated client calls the local Hono app in-process.

Scaffold this automatically with:

```bash
rivet-ts scaffold-mock --entry ./contracts.ts --out ./myapp
```

---

### 2. Promote to Bun later

```ts
import type { RivetHandler } from "rivet-ts";
import type { UserContract } from "../contract.js";

export const getUser: RivetHandler<UserContract, "GetUser"> = async ({ params }) => {
  return await db.users.findById(params.id);
};
```

```ts
import { app } from "./src/api.js";

Bun.serve({
  fetch: app.fetch,
});
```

```ts
import { configureRivet } from "./generated/rivet/rivet.js";

configureRivet({ baseUrl: "https://api.myapp.dev" });
```

Same contract. Same handler surface. Same generated client.

Only the transport changed.

---

### 3. Move to .NET later

```csharp
app.MapGet(UserContract.GetUser.Route, async (string id) =>
    (await UserContract.GetUser.Invoke(new GetUserParams(id), async input =>
    {
        return await db.Users.FindAsync(input.Id);
    })).ToResult());
```

```ts
import { configureRivet } from "./generated/rivet/rivet.js";

configureRivet({ baseUrl: "https://api.myapp.dev" });
```

Same contract JSON. Same generated TypeScript client.

Only the backend runtime changed.
