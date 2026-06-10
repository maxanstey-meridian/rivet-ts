import type { ErrorObject } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// tests/rivet-contract-schema.json is a vendored copy of the contract JSON
// schema the .NET tool validates against. Source of truth:
//   /Users/max/Sites/medway/rivet/rivet-contract-schema.json
// (rivet repo root). Keep the copy byte-identical when the upstream schema
// changes — a plain `cp` resync is intentional; do not edit the copy locally.
const schemaPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "rivet-contract-schema.json",
);

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
