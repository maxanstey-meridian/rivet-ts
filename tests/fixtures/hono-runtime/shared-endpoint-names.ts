import type { Contract, Endpoint } from "../../../src/domain/authoring-types.js";

export interface PetsContract extends Contract<"Pets"> {
  Get: Endpoint<{ method: "GET"; route: "/api/pets"; response: string }>;
}

export interface OwnersContract extends Contract<"Owners"> {
  Get: Endpoint<{ method: "GET"; route: "/api/owners"; response: string }>;
}
