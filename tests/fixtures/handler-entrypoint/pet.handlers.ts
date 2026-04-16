import { defineHandlers, handle } from "../../../dist/index.js";
import type { PetContract } from "./pet-contract.js";

export const petHandlers = defineHandlers<PetContract>()({
  ListPets: handle<PetContract, "ListPets">(async () => [
    { id: "1", name: "Buddy", species: "Dog" },
  ]),
  CreatePet: handle<PetContract, "CreatePet">(async ({ body }) => ({
    id: "2",
    name: body.name,
    species: body.species,
  })),
});
