import { rivetTs } from "rivet-ts/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: "./ui",
  plugins: [
    rivetTs({
      entry: "./packages/api/src/app/contracts.ts",
      apiRoot: "./packages/api",
      runtimeContractOut: "./packages/api/generated/api.contract.json",
      clientOutDir: "./packages/client/generated",
      rivet: {
        version: "0.34.0",
      },
    }),
  ],
});
