import { defineHandlers, handle } from "../../../dist/index.js";
import type { BrokenContract } from "./broken-contract.js";

export const brokenHandlers = defineHandlers<BrokenContract>()({
  GetBroken: handle<BrokenContract, "GetBroken">(async () => ({
    value: "broken",
  })),
});
