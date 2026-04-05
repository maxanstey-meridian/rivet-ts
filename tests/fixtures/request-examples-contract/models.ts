export interface CreateMemberRequest {
  email: string;
  role: string;
}

export const createMemberRequestExample = {
  email: "jane@example.com",
  role: "admin",
} satisfies CreateMemberRequest;

export const reviewMemberRequestExample = {
  email: "alex@example.com",
  role: "reviewer",
} satisfies CreateMemberRequest;

export const legacyMemberRequestExample = {
  email: "legacy@example.com",
  role: "member",
} satisfies CreateMemberRequest;
