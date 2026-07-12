import {
  MockProjectEmitter,
  type MockProjectEmitterConfig,
} from "../../application/ports/mock-project-emitter.js";
import {
  RivetContractDocument,
  type RivetPropertyConstraints,
  RivetTypeDefinition,
} from "../../domain/rivet-contract.js";

/**
 * Spec-side constraint reader: an openapi.json produced by the Rivet binary
 * carries the full JSON Schema constraint set (minLength, pattern, minimum,
 * minItems, …) that the TS-lowered contract document cannot express. This
 * module lifts those keywords back into the document's per-property
 * `constraints` channel before Zod source emission — by reading the JSON
 * Schema keywords directly, never via z.fromJSONSchema (which throws on
 * #/components/schemas/* refs).
 *
 * Shape contract (the C# SchemaEnricher convention): constraints are SIBLING
 * keywords on the component property schema node — next to `type`, a 3.1
 * nullable type array, an `anyOf` nullable wrapper, or a bare `$ref` alike —
 * so top-level keys of each property node are the single source of truth.
 */

export type OpenApiConstraintIndex = ReadonlyMap<
  string,
  ReadonlyMap<string, RivetPropertyConstraints>
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readNonNegativeInteger = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;

const readFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const readPropertyConstraints = (
  schema: Record<string, unknown>,
): RivetPropertyConstraints | undefined => {
  const constraints: RivetPropertyConstraints = {};

  const minLength = readNonNegativeInteger(schema.minLength);
  const maxLength = readNonNegativeInteger(schema.maxLength);
  const minItems = readNonNegativeInteger(schema.minItems);
  const maxItems = readNonNegativeInteger(schema.maxItems);
  let minimum = readFiniteNumber(schema.minimum);
  let maximum = readFiniteNumber(schema.maximum);
  let exclusiveMinimum = readFiniteNumber(schema.exclusiveMinimum);
  let exclusiveMaximum = readFiniteNumber(schema.exclusiveMaximum);
  const multipleOf = readFiniteNumber(schema.multipleOf);

  // OpenAPI 3.0 / draft-4 spelled exclusive bounds as booleans modifying
  // minimum/maximum; hand-written or converted specs still carry that shape.
  if (schema.exclusiveMinimum === true && minimum !== undefined) {
    exclusiveMinimum = minimum;
    minimum = undefined;
  }
  if (schema.exclusiveMaximum === true && maximum !== undefined) {
    exclusiveMaximum = maximum;
    maximum = undefined;
  }

  if (minLength !== undefined) {
    constraints.minLength = minLength;
  }
  if (maxLength !== undefined) {
    constraints.maxLength = maxLength;
  }
  if (typeof schema.pattern === "string") {
    constraints.pattern = schema.pattern;
  }
  if (minimum !== undefined) {
    constraints.minimum = minimum;
  }
  if (maximum !== undefined) {
    constraints.maximum = maximum;
  }
  if (exclusiveMinimum !== undefined) {
    constraints.exclusiveMinimum = exclusiveMinimum;
  }
  if (exclusiveMaximum !== undefined) {
    constraints.exclusiveMaximum = exclusiveMaximum;
  }
  if (multipleOf !== undefined) {
    constraints.multipleOf = multipleOf;
  }
  if (minItems !== undefined) {
    constraints.minItems = minItems;
  }
  if (maxItems !== undefined) {
    constraints.maxItems = maxItems;
  }
  if (schema.uniqueItems === true) {
    constraints.uniqueItems = true;
  }

  return Object.keys(constraints).length > 0 ? constraints : undefined;
};

/**
 * Extracts per-component-property constraint sets from a parsed openapi.json.
 * Anything that is not `components.schemas.<Name>.properties.<prop>` is
 * ignored — named components are the only shapes the contract document can
 * receive them on.
 */
export const readOpenApiConstraints = (spec: unknown): OpenApiConstraintIndex => {
  const index = new Map<string, ReadonlyMap<string, RivetPropertyConstraints>>();

  if (!isRecord(spec)) {
    return index;
  }
  const components = isRecord(spec.components) ? spec.components : undefined;
  const schemas = components && isRecord(components.schemas) ? components.schemas : undefined;
  if (!schemas) {
    return index;
  }

  for (const [componentName, componentSchema] of Object.entries(schemas)) {
    if (!isRecord(componentSchema) || !isRecord(componentSchema.properties)) {
      continue;
    }

    const propertyConstraints = new Map<string, RivetPropertyConstraints>();
    for (const [propertyName, propertySchema] of Object.entries(componentSchema.properties)) {
      if (!isRecord(propertySchema)) {
        continue;
      }
      const constraints = readPropertyConstraints(propertySchema);
      if (constraints) {
        propertyConstraints.set(propertyName, constraints);
      }
    }

    if (propertyConstraints.size > 0) {
      index.set(componentName, propertyConstraints);
    }
  }

  return index;
};

/**
 * Returns a document whose object type definitions carry the spec's
 * constraints, matched by exact component/property name. Untouched
 * definitions are reused as-is; an empty index returns the input document.
 */
export const enrichDocumentWithConstraints = (
  document: RivetContractDocument,
  index: OpenApiConstraintIndex,
): RivetContractDocument => {
  if (index.size === 0) {
    return document;
  }

  const types = document.types.map((definition) => {
    const componentConstraints = index.get(definition.name);
    // Alias definitions have no properties channel to enrich.
    if (!componentConstraints || definition.type !== undefined) {
      return definition;
    }

    let changed = false;
    const properties = definition.properties.map((property) => {
      const constraints = componentConstraints.get(property.name);
      if (!constraints) {
        return property;
      }
      changed = true;
      return { ...property, constraints };
    });

    return changed
      ? new RivetTypeDefinition({
          name: definition.name,
          typeParameters: definition.typeParameters,
          properties,
          description: definition.description,
        })
      : definition;
  });

  return new RivetContractDocument({
    types,
    enums: document.enums,
    endpoints: document.endpoints,
  });
};

/**
 * Decorator over the real emitter: enriches the lowered document with the
 * spec's constraints before emission, leaving the emitter itself — and the
 * no-spec scaffold path — untouched.
 */
export class ConstraintEnrichingMockProjectEmitter implements MockProjectEmitter {
  private readonly inner: MockProjectEmitter;
  private readonly index: OpenApiConstraintIndex;

  public constructor(inner: MockProjectEmitter, index: OpenApiConstraintIndex) {
    this.inner = inner;
    this.index = index;
  }

  public async emit(config: MockProjectEmitterConfig): Promise<void> {
    await this.inner.emit({
      ...config,
      document: enrichDocumentWithConstraints(config.document, this.index),
    });
  }
}
