# Local Now, Bun Later

Local mode uses the generated Rivet client against a Hono app in-process.

Server mode uses the same generated client against a deployed HTTP endpoint.

## Local mode

The scaffold starts here:

```ts
import { configureLocalRivet } from "./local-rivet.js";

configureLocalRivet();
```

That makes the generated Rivet client call the local Hono app in-process via `app.request(...)`.

This mode does not provide server-side infrastructure concerns such as persistent storage, secrets, background jobs, or external integrations.

## Promotion to Bun

If the handlers are already server-safe, promotion mainly consists of exposing the existing Hono app over HTTP.

Keep:

- the contract
- the generated client
- the handler signatures
- `src/api.ts`

Add a real server entry:

```ts
import { app } from "./src/api.js";

// Expose the same Hono app over HTTP so it can use real server-side concerns
// like databases, secrets, queues, and file storage without changing the
// contract, client shape, or handler surface.
Bun.serve({
  fetch: app.fetch,
});
```

Then switch the client config:

```ts
import { configureRivet } from "./generated/rivet/rivet.js";

configureRivet({ baseUrl: "https://api.example.com" });
```

The following remain unchanged:

- same generated client
- same client calls
- same contract
- same handler surface

The main configuration change on the client side is the `baseUrl`.

## Additional server concerns

Moving from browser-local runtime to a deployed API usually adds:

- database access
- secrets and environment configuration
- auth and session verification
- background jobs
- file storage
- webhooks and email
- logging, monitoring, and rate limiting

This promotion typically requires:

- exposing the Hono app over HTTP
- deployment and process management
