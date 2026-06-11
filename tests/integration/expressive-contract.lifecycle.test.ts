import path from "node:path";
import { fileURLToPath } from "node:url";
import { LowerTsContractsToRivetContract } from "../../src/application/use-cases/lower-ts-contracts-to-rivet-contract.js";
import { TypeScriptRivetContractLowerer } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { expectValidContractDocument } from "../contract-schema.js";

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

describe("Expressive contract lifecycle", () => {
  it("lowers a broader supported DSL surface into Rivet JSON", async () => {
    const lowerer = new TypeScriptRivetContractLowerer();
    const lowerUseCase = new LowerTsContractsToRivetContract(lowerer);

    const lowered = await lowerUseCase.execute({
      entryPath: getFixturePath(path.join("expressive-contract", "contracts.ts")),
    });

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);

    const payload = JSON.parse(lowered.toJson()) as {
      enums: Array<{ name: string; values?: string[]; intValues?: number[] }>;
      endpoints: Array<{
        name: string;
        params: Array<{ name: string; source: string; type: Record<string, unknown> }>;
        responses: Array<{
          statusCode: number;
          examples?: Array<{ mediaType: string; json: string }>;
        }>;
        requestExamples?: Array<{ json: string; mediaType: string }>;
      }>;
      types: Array<{
        name: string;
        properties: Array<Record<string, unknown>>;
      }>;
    };

    expectValidContractDocument(payload);

    expect(payload.endpoints.map((endpoint) => endpoint.name).sort()).toEqual([
      "create",
      "exportMembers",
      "ping",
      "search",
      "update",
    ]);
    expect(payload.types.map((type) => type.name).sort()).toEqual([
      "CreateMemberRequest",
      "MemberDto",
      "MemberEnvelope",
      "MemberPatch",
      "PagedResult",
      "UpdateMemberRequest",
      "ValidationErrorDto",
    ]);

    expect(payload.enums).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "MemberStatus", values: ["active", "suspended"] }),
        expect.objectContaining({ name: "MemberPriority", intValues: [1, 2, 3] }),
        expect.objectContaining({ name: "SortDirection", values: ["asc", "desc"] }),
      ]),
    );

    const searchEndpoint = payload.endpoints.find((endpoint) => endpoint.name === "search");
    expect(searchEndpoint?.params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "teamId",
          source: "route",
          isOptional: false,
          type: { kind: "primitive", type: "string", format: "uuid" },
        }),
        expect.objectContaining({
          name: "search",
          source: "query",
          isOptional: true,
          type: {
            kind: "nullable",
            inner: { kind: "primitive", type: "string" },
          },
        }),
        expect.objectContaining({
          name: "status",
          source: "query",
          isOptional: true,
          type: {
            kind: "nullable",
            inner: { kind: "ref", name: "MemberStatus" },
          },
        }),
      ]),
    );

    const createEndpoint = payload.endpoints.find((endpoint) => endpoint.name === "create");
    expect(createEndpoint?.params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "teamId",
          source: "route",
          type: { kind: "primitive", type: "string", format: "uuid" },
        }),
        expect.objectContaining({
          name: "body",
          source: "body",
          type: { kind: "ref", name: "CreateMemberRequest" },
        }),
      ]),
    );
    expect(createEndpoint?.responses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ statusCode: 201 }),
        expect.objectContaining({ statusCode: 422 }),
      ]),
    );
    expect(createEndpoint?.requestExamples).toEqual([
      {
        json: JSON.stringify({
          teamId: "550e8400-e29b-41d4-a716-446655440000",
          email: "jane@example.com",
          status: "active",
          priority: 2,
          profile: {
            displayName: "Jane Example",
            timezone: "Europe/London",
          },
          metadata: {
            invitesSent: 3,
            logins: 12,
          },
        }),
        mediaType: "application/json",
      },
    ]);
    const createSuccessResponse = createEndpoint?.responses.find(
      (response) => response.statusCode === 201,
    );
    expect(createSuccessResponse?.examples).toEqual([
      {
        mediaType: "application/json",
        json: JSON.stringify({
          data: {
            id: "550e8400-e29b-41d4-a716-446655440001",
            email: "jane@example.com",
            status: "active",
            priority: 2,
            managerId: null,
            coordinates: {
              lat: 51.5074,
              lng: -0.1278,
            },
          },
          included: ["profile", "audit"],
        }),
      },
    ]);
    expect(createEndpoint).not.toHaveProperty("successResponseExample");

    const memberDto = payload.types.find((type) => type.name === "MemberDto");
    expect(memberDto?.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "id",
          type: { kind: "primitive", type: "string", format: "uuid" },
          readOnly: true,
        }),
        expect.objectContaining({
          name: "email",
          type: {
            kind: "brand",
            name: "EmailAddress",
            underlying: { kind: "primitive", type: "string" },
          },
        }),
        expect.objectContaining({
          name: "managerId",
          optional: true,
          type: {
            kind: "nullable",
            inner: { kind: "primitive", type: "string" },
          },
        }),
      ]),
    );
  });
});
