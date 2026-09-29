import type { ErrorObject } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import fs from "node:fs";
import path from "node:path";

// tests/rivet-contract-schema.json is the contract JSON schema shipped with the
// pinned Rivet release, byte for byte (the rivet-tool-from suite checks it
// against that release's tagged file). Re-vendor it when the pin moves; never
// edit it locally.
const schemaPath = path.resolve(import.meta.dirname, "rivet-contract-schema.json");

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

export const getContractSchemaErrors = (document: unknown): readonly ErrorObject[] => {
  validate(document);
  return validate.errors ?? [];
};

export const expectValidContractDocument = (document: unknown): void => {
  const errors = getContractSchemaErrors(document);
  if (errors.length > 0) {
    const details = errors
      .map((error) => `${error.instancePath || "/"} ${error.message ?? ""}`)
      .join("\n");
    throw new Error(`Contract document failed rivet-contract-schema.json validation:\n${details}`);
  }
};
