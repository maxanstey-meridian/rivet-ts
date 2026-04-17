import { members } from "@api/generated/rivet/client/index.js";
import { configureLocalRivet } from "@api/src/local-rivet.js";

const render = async (): Promise<void> => {
  configureLocalRivet();

  const output = document.getElementById("output");
  if (!output) {
    return;
  }

  const list = await members.list();
  const created = await members.create({ email: "ada@example.com" });

  output.textContent = [
    "members.list()",
    JSON.stringify(list, null, 2),
    "",
    "members.create({ email: 'ada@example.com' })",
    JSON.stringify(created, null, 2),
  ].join("\n");
};

void render();
