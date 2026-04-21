import type { RivetHandler } from "../../../dist/index.js";
import type { BrokenContract } from "./broken-contract.js";

const getBroken: RivetHandler<BrokenContract, "GetBroken"> = async () => ({
  value: "broken",
});

export const brokenHandlers = {
  GetBroken: getBroken,
};
