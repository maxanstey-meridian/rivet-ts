# Local Now, Server Later

Local mode uses the typed `openapi-fetch` client against the Hono app in-process, in the browser. Server mode uses the same client against an HTTP endpoint. Either way, UI call sites depend on `@myapp/contracts`, not on API internals.

## Local mode

The scaffold starts here. `apps/ui/app/plugins/rivet.client.ts` configures the client once with a custom `fetch` that dispatches each built `Request` straight into the Hono app:

```ts
import { app } from "@myapp/api/local";
import { configureRivet } from "@myapp/contracts";

export default defineNuxtPlugin(() => {
  configureRivet({ fetch: (request) => app.request(request) });
});
```

Only this plugin imports `@myapp/api/local` (which re-exports the Hono `app`). Feature code sees the typed client and nothing else.

This mode does not provide server-side infrastructure concerns such as persistent storage, secrets, background jobs, or external integrations.

## Promotion to a real server

The scaffolded API already has a server entry — `apps/api/src/main.ts`:

```ts
import { serve } from "@hono/node-server";
import { app } from "./app.js";

serve({ fetch: app.fetch, port: 5180 }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
```

Run it with `task api:run`, then switch the UI plugin's transport:

```ts
import { configureRivet } from "@myapp/contracts";

export default defineNuxtPlugin(() => {
  configureRivet({ baseUrl: "http://localhost:5180" });
});
```

Keep: the contract, the generated client, the handler signatures, `apps/api/src/app.ts`. Change: one line of transport config. The same Hono app can be served by any Hono-compatible runtime (`@hono/node-server` is what the scaffold wires; Bun's `Bun.serve({ fetch: app.fetch })` also works).

Error behavior stays identical across both modes by construction: the scaffolded `app.onError` turns unhandled handler errors into the same structured 500 envelope whether the app runs in-browser or as a server.

## Additional server concerns

Moving from browser-local runtime to a deployed API usually adds the real work:

- database access
- secrets and environment configuration
- auth and session verification
- background jobs
- file storage
- webhooks and email
- logging, monitoring, and rate limiting

Transport promotion is trivial; infrastructure promotion is the actual project.
