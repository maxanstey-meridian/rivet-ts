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

With `Rivet.Attributes` 0.41, input binding, application execution, contract-owned results, and host adaptation are separate steps:

```csharp
app.MapGet(UsersContract.Get.Route, async (string id, CancellationToken ct) =>
{
    var endpoint = UsersContract.Get.Bind(new GetUserParams(id));
    var user = await getUser.ExecuteAsync(id, ct);

    return user is null
        ? endpoint.Error(404, new ApiError("User not found")).ToResult()
        : endpoint.Success(user).ToResult();
});
```

Input-bearing operations call `Bind(input)` before application code runs. Operations without input call their terminal method directly:

```csharp
var health = await healthCheck.ExecuteAsync(ct);
return SystemContract.Health.Success(health).ToActionResult();
```

Known non-success outcomes use a declared `Error(...)`. File contracts use `File(...)`, with the content type supplied by the contract:

```csharp
var endpoint = ReportsContract.Download.Bind(new DownloadReportParams(id));
var report = await createReport.ExecuteAsync(id, ct);

return report is null
    ? endpoint.Error(404, new ApiError("Report not found")).ToActionResult()
    : endpoint.File(report.Content, report.FileName).ToActionResult();
```

Every terminal returns a Rivet result. Convert it only at the host boundary with `ToActionResult()` for MVC or `ToResult()` for Minimal APIs.

This surface is part of main Rivet:

- C# contracts
- `.Route` and `Bind(input)` for input-bearing operations
- `Success(...)`, `Error(...)`, and `File(...)` terminal results
- `ToActionResult()` and `ToResult()` host adapters
- the same binary emits OpenAPI 3.1 from the C# side, so the client keeps coming from the same `openapi-typescript` + `openapi-fetch` pipeline

## Practical handoff model

1. start with a TS contract and scaffold the local app
2. use the generated client from the scaffolded UI
3. stabilize the frontend against that client
4. when `.NET` ownership becomes necessary, re-express the contract in main Rivet and implement the real server there
5. keep the frontend client usage stable and change the URL
