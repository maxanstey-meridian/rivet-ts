import type { EndpointAuthoringSuccessStatus } from "./authoring-types.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// Keyed by the authoring union, so the compiler rejects a missing or extra status.
const SUCCESS_STATUSES: Readonly<Record<EndpointAuthoringSuccessStatus, true>> = {
  200: true,
  201: true,
  202: true,
  203: true,
  204: true,
  205: true,
  206: true,
  207: true,
  208: true,
  226: true,
};

export const SUCCESS_STATUS_CODES: readonly number[] = Object.keys(SUCCESS_STATUSES).map(Number);

export const isSuccessStatus = (status: number): status is EndpointAuthoringSuccessStatus =>
  Object.hasOwn(SUCCESS_STATUSES, status);

// HTTP forbids a message body on these; C# Rivet refuses authored content there (RIV1102).
export const isBodyForbiddenStatus = (status: number): boolean =>
  (status >= 100 && status < 200) || status === 204 || status === 205 || status === 304;

// The success status when a contract names none, shared with the type-level
// SuccessStatus in runtime-types.ts and the .NET extractor:
// POST -> 201; DELETE with a void response -> 204; everything else -> 200.
export const getDefaultSuccessStatus = (
  httpMethod: string,
  hasResponseBody: boolean,
): EndpointAuthoringSuccessStatus => {
  switch (httpMethod) {
    case "DELETE":
      return hasResponseBody ? 200 : 204;
    case "POST":
      return 201;
    default:
      return 200;
  }
};
