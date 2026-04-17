import { defineConfig } from "vite";
import { rivetTs } from "rivet-ts/vite";

export default defineConfig({
  root: "./ui",
  plugins: [
    rivetTs({
      contract: "./packages/api/contracts.ts",
      apiRoot: "./packages/api",
      app: "./packages/api/src/api.ts",
      rivet: {
        version: "0.33.0",
      },
    }),
  ],
});
