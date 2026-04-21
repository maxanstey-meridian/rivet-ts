import type { RivetHandlerInput, RivetHandlerResult } from "rivet-ts";
import type { MembersContract } from "#contract";

type CreateInput = RivetHandlerInput<MembersContract, "Create">;
type CreateOutput = RivetHandlerResult<MembersContract, "Create">;

export const executeCreate = async (_input: CreateInput): Promise<CreateOutput> => {
  return {
    id: "example",
    email: "example",
    role: "admin",
  };
};
