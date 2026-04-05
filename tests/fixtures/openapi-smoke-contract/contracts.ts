import type { Contract, Endpoint } from "../../../dist/index.js";
import type {
  CreateItemRequest,
  DeleteAckDto,
  ItemDto,
  SubmitFormRequest,
  UploadDocumentRequest,
  ValidationErrorDto,
} from "./models.js";
import {
  createItemRequestExample,
  createItemResponseExample,
  deleteAckExample,
  fileErrorExample,
  namedRequestExample,
  refBackedRequestExample,
  submitFormRequestExample,
  validationErrorExample,
} from "./models.js";

export interface OpenApiSmokeContract extends Contract<"OpenApiSmokeContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/items";
    input: CreateItemRequest;
    response: ItemDto;
    successStatus: 201;
    requestExamples: [
      typeof createItemRequestExample,
      { name: "reviewer payload"; json: typeof namedRequestExample },
      {
        name: "component-backed";
        componentExampleId: "CreateItemExample";
        resolvedJson: typeof refBackedRequestExample;
      },
    ];
    responseExamples: [
      { status: 201; examples: [typeof createItemResponseExample] },
      { status: 422; examples: [typeof validationErrorExample] },
    ];
    errors: [{ status: 422; response: ValidationErrorDto; description: "Validation failed" }];
  }>;

  SubmitForm: Endpoint<{
    method: "POST";
    route: "/api/forms";
    input: SubmitFormRequest;
    response: void;
    formEncoded: true;
    requestExamples: [typeof submitFormRequestExample];
  }>;

  UploadDocument: Endpoint<{
    method: "PUT";
    route: "/api/documents/{documentId}/upload";
    input: UploadDocumentRequest;
    response: void;
    acceptsFile: true;
  }>;

  DeleteItem: Endpoint<{
    method: "DELETE";
    route: "/api/items/{id}";
    response: void;
    responseExamples: [{ status: 204; examples: [typeof deleteAckExample] }];
  }>;

  ExportItems: Endpoint<{
    method: "GET";
    route: "/api/items/export";
    fileResponse: true;
    fileContentType: "text/csv";
    responseExamples: [
      { status: 200; examples: [typeof createItemResponseExample] },
      { status: 422; examples: [typeof fileErrorExample] },
    ];
    errors: [{ status: 422; response: ValidationErrorDto; description: "Export failed" }];
  }>;
}
