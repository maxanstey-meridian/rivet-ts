import type { Contract, Endpoint } from "@maxanstey-meridian/rivet-ts";

export type QuoteDto = {
  id: string;
  text: string;
  author: string;
  addedAt: string;
};

export type AddQuoteRequest = {
  text: string;
  author: string;
};

export type UserDto = {
  id: string;
  name: string;
};

export type ApiError = {
  code: string;
  message: string;
};

export type ValidationError = {
  code: string;
  message: string;
  errors: Record<string, string[]>;
};

export interface QuotesContract extends Contract<"Quotes"> {
  ListQuotes: Endpoint<{
    method: "GET";
    route: "/api/quotes";
    response: QuoteDto[];
    summary: "List all quotes";
  }>;

  AddQuote: Endpoint<{
    method: "POST";
    route: "/api/quotes";
    input: AddQuoteRequest;
    response: QuoteDto;
    successStatus: 201;
    errors: [
      { status: 409; response: ApiError; description: "Duplicate quote text" },
      { status: 422; response: ValidationError; description: "Validation failed" },
    ];
    summary: "Add a quote";
  }>;
}

export interface UsersContract extends Contract<"Users"> {
  Me: Endpoint<{
    method: "GET";
    route: "/api/me";
    response: UserDto;
    summary: "The current user";
  }>;
}
