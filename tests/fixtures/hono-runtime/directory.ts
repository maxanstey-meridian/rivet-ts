import type { Contract, Endpoint } from "../../../src/domain/authoring-types.js";

export interface DirectorySearchRequest {
  readonly query: string;
}

export interface DirectorySearchResponse {
  readonly query: string;
}

export interface DirectoryStatusResponse {
  readonly status: "ok";
}

export interface ConflictDto {
  readonly code: "conflict";
}

export interface SubmitFormRequest {
  readonly name: string;
  readonly email: string;
}

export interface UploadDocumentRequest {
  readonly documentId: string;
  readonly file: File;
  readonly title: string;
  readonly description: string;
}

export interface DirectoryContract extends Contract<"DirectoryContract"> {
  Search: Endpoint<{
    method: "POST";
    route: "/api/directory/search";
    input: DirectorySearchRequest;
    response: DirectorySearchResponse;
    successStatus: 201;
    errors: [{ status: 409; response: ConflictDto }];
  }>;

  Health: Endpoint<{
    method: "GET";
    route: "/api/directory/health";
    response: DirectoryStatusResponse;
  }>;

  Export: Endpoint<{
    method: "GET";
    route: "/api/directory/export";
    fileResponse: true;
    fileContentType: "text/csv";
    response: void;
  }>;

  SubmitForm: Endpoint<{
    method: "POST";
    route: "/api/directory/forms";
    input: SubmitFormRequest;
    response: DirectorySearchResponse;
    formEncoded: true;
  }>;

  UploadDocument: Endpoint<{
    method: "PUT";
    route: "/api/directory/documents/{documentId}";
    input: UploadDocumentRequest;
    response: void;
    successStatus: 204;
    acceptsFile: true;
  }>;
}

export interface CatalogItemDto {
  readonly id: number;
}

export interface CatalogQuery {
  readonly page: number;
  readonly includeArchived?: boolean;
  readonly tags?: string[];
}

export interface CatalogContract extends Contract<"CatalogContract"> {
  GetItem: Endpoint<{
    method: "GET";
    route: "/api/catalog/{id}";
    params: { readonly id: number };
    response: CatalogItemDto;
  }>;

  // A bodyless method's input is its query string.
  ListItems: Endpoint<{
    method: "GET";
    route: "/api/catalog";
    input: CatalogQuery;
    response: CatalogQuery;
  }>;
}

export interface PetContract extends Contract<"Pet"> {
  Ping: Endpoint<{ method: "POST"; route: "/api/ping"; response: void; successStatus: 204 }>;
}

export interface SummaryContract extends Contract<"Summary"> {
  Health: Endpoint<{ method: "GET"; route: "/api/health"; response: { status: "ok" } }>;
}
