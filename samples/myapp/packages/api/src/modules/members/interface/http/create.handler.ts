import type { RivetHandler } from "rivet-ts";
import type { MembersContract } from "#contract";
import { executeCreate } from "../../application/create.use-case.js";

export const createHandler: RivetHandler<MembersContract, "Create"> = async (input) => {
  return executeCreate(input);
};
