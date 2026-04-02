import type { Brand, Format } from "../../../src/index.js";

export enum MemberStatus {
  Active = "active",
  Suspended = "suspended",
}

export type MemberPriority = 1 | 2 | 3;

export type SortDirection = "asc" | "desc";

export type PagedResult<TItem> = {
  items: TItem[];
  totalCount: number;
};

export type MemberEnvelope<TData> = {
  data: TData;
  included?: string[];
};

export interface SearchMembersQuery {
  teamId: Format<string, "uuid">;
  search?: string | null;
  status?: MemberStatus | null;
  priority?: MemberPriority;
  includeInactive?: boolean;
  sort?: SortDirection;
}

export interface CreateMemberRequest {
  teamId: Format<string, "uuid">;
  email: Brand<string, "EmailAddress">;
  status: MemberStatus;
  priority: MemberPriority;
  profile: {
    displayName: string;
    timezone: string;
  };
  metadata: Record<string, number>;
}

export type MemberPatch = {
  nickname?: string | null;
  status?: MemberStatus;
  preferences: {
    digest: boolean;
    channels: string[];
  };
};

export interface UpdateMemberRequest {
  id: Format<string, "uuid">;
  patch: MemberPatch;
}

export interface MemberDto {
  readonly id: Format<string, "uuid">;
  email: Brand<string, "EmailAddress">;
  status: MemberStatus;
  priority: MemberPriority;
  managerId?: string | null;
  coordinates: {
    lat: number;
    lng: number;
  };
}

export interface ValidationErrorDto {
  message: string;
  fields: Record<string, string[]>;
}
