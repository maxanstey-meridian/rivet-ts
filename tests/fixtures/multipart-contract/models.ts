export interface UploadDocumentRequest {
  documentId: string;
  file: Blob;
  title: string;
  description: string;
}
