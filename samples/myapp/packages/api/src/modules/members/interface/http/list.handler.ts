import type { RivetHandler } from "rivet-ts";
import type { MembersContract } from "#contract";
import { executeList } from "../../application/list.use-case.js";

export const listHandler: RivetHandler<MembersContract, "List"> = async () => {
  return executeList({});
};
