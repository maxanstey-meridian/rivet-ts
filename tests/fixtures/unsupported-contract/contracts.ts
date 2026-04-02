import type { Contract, Endpoint } from "../../../dist/index.js";
import type {
  BadSearchQuery,
  ConditionalDto,
  InlineOptionalWrapper,
  IntersectionWrapper,
} from "./models.js";

export interface UnsupportedContract extends Contract<"UnsupportedContract"> {
  Search: Endpoint<{
    method: "GET";
    route: "/api/teams/{teamId}/items";
    input: BadSearchQuery;
    response: ConditionalDto<string>;
  }>;

  Details: Endpoint<{
    method: "GET";
    route: "/api/details";
    response: InlineOptionalWrapper;
  }>;

  Intersect: Endpoint<{
    method: "GET";
    route: "/api/intersect";
    response: IntersectionWrapper;
  }>;
}
