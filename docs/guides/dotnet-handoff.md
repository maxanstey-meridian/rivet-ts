# .NET Handoff

When the backend moves to `.NET`, the frontend can continue using the generated Rivet client while backend ownership moves to main Rivet.

## What stays the same

For the frontend:

- you still use the typed `openapi-fetch` client from `@myapp/contracts`
- you still call `configureRivet(...)`
- your client call sites do not need a new abstraction

```ts
import { client, configureRivet } from "@myapp/contracts";

configureRivet({ baseUrl: "https://api.example.com" });

const { data, error } = await client.GET("/users/{id}", {
  params: { path: { id: "usr_123" } },
});
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
- the same binary emits OpenAPI 3.1 from the C# side, so the client keeps coming from the same `openapi-typescript` + `openapi-fetch` pipeline

## Practical handoff model

1. start with a TS contract and scaffold the local app
2. use the generated client from the scaffolded UI
3. stabilize the frontend against that client
4. when `.NET` ownership becomes necessary, re-express the contract in main Rivet and implement the real server there
5. keep the frontend client usage stable and change the URL
