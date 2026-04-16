export interface PetDto {
  id: string;
  name: string;
  species: string;
}

export interface CreatePetRequest {
  name: string;
  species: string;
}

export interface SummaryDto {
  totalPets: number;
  totalSpecies: number;
}
