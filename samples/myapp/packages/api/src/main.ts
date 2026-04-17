import { configureLocalRivet } from "./local-rivet.js";

configureLocalRivet();

const output = document.getElementById("output");

if (output) {
  output.textContent = [
    "Local Rivet transport configured.",
    "Run pnpm run generate, then import your generated client from ../generated/rivet/client.",
  ].join("\n");
}
