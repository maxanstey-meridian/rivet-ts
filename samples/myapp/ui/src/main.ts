import { client } from "@myapp/client";
import { configureLocalRivet } from "../rivet-local";

const render = async () => {
  configureLocalRivet();

  const output = document.getElementById("output");
  if (!output) {
    return;
  }

  const result = await client.GET("/api/members");

  output.textContent = [
    'client.GET("/api/members")',
    JSON.stringify(result.data, null, 2),
    "",
    "Open ui/src/main.ts and keep consuming @myapp/client.",
  ].join("\n");
};

void render();
