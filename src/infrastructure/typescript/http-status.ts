// HTTP forbids a message body on these; C# Rivet refuses authored content there (RIV1102).
export const isBodyForbiddenStatus = (status: number): boolean =>
  (status >= 100 && status < 200) || status === 204 || status === 205 || status === 304;

// Default success-status table, shared with the .NET extractor and the
// type-level SuccessStatus in src/domain/runtime-types.ts:
// POST -> 201; DELETE with a void response -> 204; everything else -> 200.
export const getDefaultSuccessStatus = (httpMethod: string, hasResponseBody: boolean): number => {
  switch (httpMethod) {
    case "DELETE":
      return hasResponseBody ? 200 : 204;
    case "POST":
      return 201;
    default:
      return 200;
  }
};
