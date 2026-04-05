export interface CreateMemberRequest {
  email: string;
  role: string;
}

export interface MemberDto {
  id: string;
  email: string;
}

export interface ValidationErrorDto {
  message: string;
  code: string;
}

export const createSuccessResponseExample = {
  id: "mem_001",
  email: "jane@example.com",
} satisfies MemberDto;

export const createSuccessResponseExample2 = {
  id: "mem_002",
  email: "alex@example.com",
} satisfies MemberDto;

export const validationErrorExample = {
  message: "Email is required",
  code: "VALIDATION_ERROR",
} satisfies ValidationErrorDto;

export const createRequestExample = {
  email: "jane@example.com",
  role: "admin",
} satisfies CreateMemberRequest;

export const legacyResponseExample = {
  id: "mem_legacy",
  email: "legacy@example.com",
} satisfies MemberDto;
