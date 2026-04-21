import { members } from "@myapp/client";
import { configureLocalRivet } from "../rivet-local";

const render = async () => {
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
    "Open ui/src/main.ts and keep consuming @myapp/client.",
  ].join("\n");
};

void render();
