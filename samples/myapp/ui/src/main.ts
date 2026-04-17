import { members } from "@api/generated/rivet/client/index.js";
import { configureLocalRivet } from "@api/src/local-rivet.js";

const render = async (): Promise<void> => {
  configureLocalRivet();

  const output = document.getElementById("output");
  if (!output) {
    return;
  }

  const result = await members.list();

  output.textContent = [
    "members.list()",
    JSON.stringify(result, null, 2),
    "",
    "Open ui/src/main.ts and keep consuming @api/generated/rivet/client.",
  ].join("\n");
};

void render();
