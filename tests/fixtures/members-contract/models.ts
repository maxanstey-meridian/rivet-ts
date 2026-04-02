export interface MemberDto {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface InviteMemberRequest {
  email: string;
  role: string;
  nickname: string;
}

export interface InviteMemberResponse {
  id: string;
}

export interface UpdateRoleRequest {
  role: string;
}

export interface NotFoundDto {
  message: string;
}

export interface ValidationErrorDto {
  message: string;
  errors: Record<string, string[]>;
}

export interface PagedResult<TItem> {
  items: TItem[];
  totalCount: number;
}
