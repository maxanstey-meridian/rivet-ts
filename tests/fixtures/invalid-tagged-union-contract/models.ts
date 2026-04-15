export type DifferentDiscriminatorState =
  | { kind: "hidden"; workspaceKey: string | null }
  | { state: "shown"; summary: string };

export type DuplicateTagState =
  | { kind: "hidden"; workspaceKey: string | null }
  | { kind: "hidden"; summary: string };

export type OptionalVariantFieldState =
  | { kind: "loading"; requestId?: string; workspaceKey: string }
  | { kind: "shown"; summary: string; workspaceKey: string };

export type MixedMemberState = { kind: "hidden"; workspaceKey: string | null } | "shown";
