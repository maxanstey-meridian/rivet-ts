import type { Contract, Endpoint } from "../../../dist/index.js";
import type {
  DifferentDiscriminatorState,
  DuplicateTagState,
  MixedMemberState,
  OptionalVariantFieldState,
} from "./models.js";

export interface InvalidTaggedUnionContract extends Contract<"InvalidTaggedUnionContract"> {
  DifferentDiscriminator: Endpoint<{
    method: "GET";
    route: "/display/different-discriminator";
    response: DifferentDiscriminatorState;
  }>;

  DuplicateTag: Endpoint<{
    method: "GET";
    route: "/display/duplicate-tag";
    response: DuplicateTagState;
  }>;

  OptionalVariantField: Endpoint<{
    method: "GET";
    route: "/display/optional-variant-field";
    response: OptionalVariantFieldState;
  }>;

  MixedMember: Endpoint<{
    method: "GET";
    route: "/display/mixed-member";
    response: MixedMemberState;
  }>;
}
