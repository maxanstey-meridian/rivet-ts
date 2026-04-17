import type { RivetHandler } from "rivet-ts";
import type { MembersContract } from "../contract.js";

export const list: RivetHandler<MembersContract, "List"> = async () => {
  return [
    {
      "id": "example",
      "email": "example",
      "role": "admin"
    }
  ];
};
