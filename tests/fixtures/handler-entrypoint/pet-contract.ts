import type { Contract, Endpoint } from "../../../dist/index.js";
import type { CreatePetRequest, PetDto } from "./models.js";

export interface PetContract extends Contract<"PetContract"> {
  ListPets: Endpoint<{
    method: "GET";
    route: "/api/pets";
    response: PetDto[];
  }>;

  CreatePet: Endpoint<{
    method: "POST";
    route: "/api/pets";
    input: CreatePetRequest;
    response: PetDto;
    successStatus: 201;
  }>;
}
