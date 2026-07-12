import type { RivetHandlerInput, RivetHandlerResult } from "rivet-ts";
import type { MembersContract } from "#contract";

type ListInput = RivetHandlerInput<MembersContract, "List">;
type ListOutput = RivetHandlerResult<MembersContract, "List">;

export const executeList = async (_input: ListInput): Promise<ListOutput> => {
  return [
    {
      id: "example",
      email: "example",
      role: "admin",
    },
  ];
};
