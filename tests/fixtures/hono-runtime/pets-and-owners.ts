import type { Contract, Endpoint } from "../../../src/domain/authoring-types.js";

export interface PetsContract extends Contract<"Pets"> {
  ListPets: Endpoint<{ method: "GET"; route: "/api/pets"; response: { readonly kind: "pets" } }>;
}

export interface OwnersContract extends Contract<"Owners"> {
  ListOwners: Endpoint<{
    method: "GET";
    route: "/api/owners";
    response: { readonly kind: "owners" };
  }>;
  GetOwner: Endpoint<{
    method: "GET";
    route: "/api/owners/{OwnerId}";
    input: { ownerId: number };
    response: { readonly id: number };
  }>;
}
