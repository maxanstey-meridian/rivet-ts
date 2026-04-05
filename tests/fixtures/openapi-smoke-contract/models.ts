export interface CreateItemRequest {
  email: string;
  role: string;
}

export interface ItemDto {
  id: string;
  email: string;
}

export interface ValidationErrorDto {
  message: string;
  code: string;
}

export interface SubmitFormRequest {
  name: string;
  email: string;
}

export interface UploadDocumentRequest {
  documentId: string;
  file: Blob;
  title: string;
}

export interface DeleteAckDto {
  deletedAt: string;
}

export const createItemRequestExample = {
  email: "jane@example.com",
  role: "admin",
} satisfies CreateItemRequest;

export const namedRequestExample = {
  email: "alex@example.com",
  role: "reviewer",
} satisfies CreateItemRequest;

export const refBackedRequestExample = {
  email: "component@example.com",
  role: "member",
} satisfies CreateItemRequest;

export const createItemResponseExample = {
  id: "item_001",
  email: "jane@example.com",
} satisfies ItemDto;

export const validationErrorExample = {
  message: "Email is required",
  code: "VALIDATION_ERROR",
} satisfies ValidationErrorDto;

export const submitFormRequestExample = {
  name: "Jane Doe",
  email: "jane@example.com",
} satisfies SubmitFormRequest;

export const deleteAckExample = {
  deletedAt: "2026-01-01T00:00:00Z",
} satisfies DeleteAckDto;

export const fileErrorExample = {
  message: "File not found",
  code: "NOT_FOUND",
} satisfies ValidationErrorDto;
