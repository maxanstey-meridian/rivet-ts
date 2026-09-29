import type { Contract, Endpoint } from "../../../src/domain/authoring-types.js";
import type { UploadDocumentRequest } from "./models.js";

export interface MultipartContract extends Contract<"MultipartContract"> {
  UploadDocument: Endpoint<{
    method: "PUT";
    route: "/api/documents/{documentId}/upload";
    input: UploadDocumentRequest;
    response: void;
    acceptsFile: true;
  }>;
}
