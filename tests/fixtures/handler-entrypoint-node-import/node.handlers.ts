import fs from "node:fs";
import type { RivetHandler } from "../../../dist/index.js";
import type { NodeContract } from "./node-contract.js";

const readFile: RivetHandler<NodeContract, "ReadFile"> = async () => {
  return fs.readFileSync("/tmp/rivet-test-file", "utf-8");
};

export const nodeHandlers = {
  ReadFile: readFile,
};
