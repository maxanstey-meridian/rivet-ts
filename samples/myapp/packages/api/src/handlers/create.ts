import type { RivetHandler } from "rivet-ts";
import type { MembersContract } from "../contract.js";

export const create: RivetHandler<MembersContract, "Create"> = async ({ body }) => {
  return {
    "id": "example",
    "email": "example",
    "role": "admin"
  };
};
