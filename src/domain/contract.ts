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
