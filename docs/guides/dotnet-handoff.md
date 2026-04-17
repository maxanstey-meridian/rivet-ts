# .NET Handoff

When the backend moves to `.NET`, the frontend can continue using the generated Rivet client while backend ownership moves to main Rivet.

## What stays the same

For the frontend:

- you still use the generated Rivet client
- you still call `configureRivet(...)`
- your client call sites do not need a new abstraction

```ts
import { configureRivet } from "./generated/rivet/rivet.js";
import { users } from "./generated/rivet/client/index.js";

configureRivet({ baseUrl: "https://api.example.com" });

const user = await users.getUser("usr_123");
```

## What changes

The backend runtime changes.

In `.NET`, the typical Rivet runtime pattern is:

```csharp
app.MapGet(UsersContract.Get.Route, async (string id) =>
    (await UsersContract.Get.Invoke(new GetUserParams(id), async input =>
    {
        return await db.Users.FindAsync(input.Id);
    })).ToResult());
```

That is part of main Rivet:

- C# contracts
- `.Route` and `.Invoke(...)`
- server-side OpenAPI and client generation from the C# side

## Practical handoff model

1. start with a TS contract and local Hono scaffold
2. generate the client and OpenAPI downstream
3. stabilize the frontend against that client
4. when `.NET` ownership becomes necessary, re-express the contract in main Rivet and implement the real server there
5. keep the frontend client usage stable and change the URL
