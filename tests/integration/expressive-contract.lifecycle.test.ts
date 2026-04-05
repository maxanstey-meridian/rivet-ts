import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExtractTsContracts } from "../../src/application/use-cases/extract-ts-contracts.js";
import { LowerContractBundleToRivetContract } from "../../src/application/use-cases/lower-contract-bundle-to-rivet-contract.js";
import { TypeScriptContractFrontend } from "../../src/infrastructure/typescript/typescript-contract-frontend.js";
import { TypeScriptRivetContractLowerer } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

describe("Expressive contract lifecycle", () => {
  it("lowers a broader supported DSL surface into Rivet JSON", async () => {
    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);

    const bundle = await extractUseCase.execute({
      entryPath: getFixturePath(path.join("expressive-contract", "contracts.ts")),
    });
    const lowered = await lowerUseCase.execute({ bundle });

    expect(bundle.hasErrors).toBe(false);
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

    const writeFixture = process.env.UPDATE_GOLDEN === "1";
    const goldenPath = getFixturePath(path.join("expressive-contract", "golden-contract.json"));
    if (writeFixture) {
      await fs.writeFile(goldenPath, `${lowered.toJson()}\n`, "utf8");
    }

    const expected = JSON.parse(await fs.readFile(goldenPath, "utf8")) as unknown;
    expect(payload).toEqual(expected);

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
          type: { kind: "primitive", type: "string", format: "uuid" },
        }),
        expect.objectContaining({
          name: "search",
          source: "query",
          type: {
            kind: "nullable",
            inner: { kind: "primitive", type: "string" },
          },
        }),
        expect.objectContaining({
          name: "status",
          source: "query",
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
