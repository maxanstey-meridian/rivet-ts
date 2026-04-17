# How It Works

`rivet-ts` is a TypeScript contract authoring and scaffolding pipeline.

## 1. Author in TypeScript

You write a contract using:

- `Contract<"...">`
- `Endpoint<{ ... }>`
- normal exported TypeScript DTOs and example values

That contract is the source of truth for:

- routes
- HTTP methods
- inputs and outputs
- status codes
- errors
- examples
- security metadata

## 2. Reflect to Rivet JSON

`rivet-reflect-ts` reads the TypeScript contract graph and lowers it into Rivet's intermediate contract document.

That document is the bridge between:

- the TS authoring world
- the scaffold workflow
- downstream Rivet codegen

## 3. Scaffold a local Hono app

`rivet-ts scaffold-mock` uses the lowered contract to emit:

- a Hono app
- plain async handlers
- local transport wiring through `configureLocalRivet()`
- a minimal Vite shell
- copied contract source

The handlers are plain TypeScript functions typed against the contract surface with `RivetHandler<...>`.

## 4. Generate downstream artifacts

Main Rivet consumes the reflected contract JSON and emits:

- TypeScript DTOs
- a typed client
- OpenAPI
- validators
- JSON Schema

Artifact generation remains in downstream Rivet.

## 5. Promote transport later

Locally, the generated client talks to Hono in-process.

Later, the same app can be exposed over HTTP and the generated client can switch to:

```ts
configureRivet({ baseUrl: "https://api.example.com" });
```

The generated client can then be reconfigured to target a deployed API.
