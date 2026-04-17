import { members, configureLocalRivet } from "@api";

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
    "Open ui/src/main.ts and keep consuming @api.",
  ].join("\n");
};

void render();
