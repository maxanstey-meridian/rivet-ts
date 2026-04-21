import type { RivetHandler } from "../../../dist/index.js";
import type { PetContract } from "./pet-contract.js";

const listPets: RivetHandler<PetContract, "ListPets"> = async () => [
  { id: "1", name: "Buddy", species: "Dog" },
];

const createPet: RivetHandler<PetContract, "CreatePet"> = async ({ body }) => ({
  id: "2",
  name: body.name,
  species: body.species,
});

export const petHandlers = {
  ListPets: listPets,
  CreatePet: createPet,
};
