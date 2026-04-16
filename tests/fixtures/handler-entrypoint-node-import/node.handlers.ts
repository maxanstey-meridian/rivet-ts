import fs from "node:fs";
import { defineHandlers, handle } from "../../../dist/index.js";
import type { NodeContract } from "./node-contract.js";

export const nodeHandlers = defineHandlers<NodeContract>()({
  ReadFile: handle<NodeContract, "ReadFile">(async () => {
    return fs.readFileSync("/tmp/rivet-test-file", "utf-8");
  }),
});
