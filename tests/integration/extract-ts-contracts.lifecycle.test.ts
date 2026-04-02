import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExtractTsContracts } from "../../src/application/use-cases/extract-ts-contracts.js";
import { TypeScriptContractFrontend } from "../../src/infrastructure/typescript/typescript-contract-frontend.js";

const getProjectRoot = (): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "..");
};

const toImportPath = (fromDirectory: string, targetFilePath: string): string => {
  const relativePath = path.relative(fromDirectory, targetFilePath).split(path.sep).join("/");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
};

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

describe("ExtractTsContracts lifecycle", () => {
  it("extracts a contract bundle from a real TS fixture program", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);

    const bundle = await useCase.execute({
      entryPath: getFixturePath(path.join("members-contract", "contracts.ts")),
    });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.contracts).toHaveLength(1);
    expect(bundle.referencedTypes).toEqual(
      expect.arrayContaining([
        "InviteMemberRequest",
        "InviteMemberResponse",
        "MemberDto",
        "NotFoundDto",
        "PagedResult",
        "UpdateRoleRequest",
        "ValidationErrorDto",
      ]),
    );

    const [contract] = bundle.contracts;
    expect(contract.name).toBe("MembersContract");
    expect(contract.endpoints).toHaveLength(5);

    const list = contract.endpoints.find((endpoint) => endpoint.name === "List");
    expect(list).toMatchObject({
      method: "GET",
      route: "/api/members",
      description: "List all team members",
    });
    expect(list?.response?.text).toBe("PagedResult<MemberDto>");

    const invite = contract.endpoints.find((endpoint) => endpoint.name === "Invite");
    expect(invite).toMatchObject({
      method: "POST",
      route: "/api/members",
      successStatus: 201,
      securityScheme: "admin",
    });
    expect(invite?.input?.text).toBe("InviteMemberRequest");
    expect(invite?.response?.text).toBe("InviteMemberResponse");
    expect(invite?.errors).toHaveLength(1);
    expect(invite?.errors[0]).toMatchObject({
      status: 422,
      description: "Validation failed",
    });

    const health = contract.endpoints.find((endpoint) => endpoint.name === "Health");
    expect(health).toMatchObject({
      method: "GET",
      route: "/api/health",
      anonymous: true,
      description: "Health check",
    });
    expect(health?.response).toBeUndefined();
  });

  it("extracts the broader supported endpoint metadata surface from the public DSL", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);

    const bundle = await useCase.execute({
      entryPath: getFixturePath(path.join("expressive-contract", "contracts.ts")),
    });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.diagnostics).toEqual([]);
    expect(bundle.contracts).toHaveLength(1);

    const [contract] = bundle.contracts;
    expect(contract.name).toBe("MembersContract");
    expect(contract.endpoints).toHaveLength(5);

    const search = contract.endpoints.find((endpoint) => endpoint.name === "Search");
    expect(search).toMatchObject({
      method: "GET",
      route: "/api/teams/{teamId}/members",
      summary: "Search members",
      description: "Search members in a team",
    });
    expect(search?.input?.text).toBe("SearchMembersQuery");
    expect(search?.response?.text).toBe("PagedResult<MemberDto>");

    const create = contract.endpoints.find((endpoint) => endpoint.name === "Create");
    expect(create).toMatchObject({
      method: "POST",
      route: "/api/teams/{teamId}/members",
      successStatus: 201,
      securityScheme: "admin",
    });
    expect(create?.input?.text).toBe("CreateMemberRequest");
    expect(create?.response?.text).toBe("MemberEnvelope<MemberDto>");
    expect(create?.errors).toEqual([
      expect.objectContaining({
        status: 422,
        description: "Validation failed",
      }),
    ]);

    const update = contract.endpoints.find((endpoint) => endpoint.name === "Update");
    expect(update?.errors).toEqual([
      expect.objectContaining({
        status: 404,
        description: "Member not found",
      }),
    ]);

    const exportMembers = contract.endpoints.find((endpoint) => endpoint.name === "ExportMembers");
    expect(exportMembers).toMatchObject({
      method: "GET",
      route: "/api/teams/{teamId}/members/export",
      fileResponse: true,
      fileContentType: "text/csv",
      summary: "Export members",
      description: "Download members as CSV",
      securityScheme: "admin",
    });
    expect(exportMembers?.response).toBeUndefined();

    const ping = contract.endpoints.find((endpoint) => endpoint.name === "Ping");
    expect(ping).toMatchObject({
      method: "GET",
      route: "/api/ping",
      anonymous: true,
      description: "Anonymous liveness probe",
    });
  });

  it("extracts aliased endpoint authoring specs exported from the public DSL", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);

    const bundle = await useCase.execute({
      entryPath: getFixturePath(path.join("aliased-authoring-contract", "contracts.ts")),
    });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.diagnostics).toEqual([]);
    expect(bundle.contracts).toHaveLength(1);

    const [contract] = bundle.contracts;
    expect(contract.name).toBe("AliasedMembersContract");
    expect(contract.endpoints).toHaveLength(1);

    expect(contract.endpoints[0]).toMatchObject({
      name: "List",
      method: "GET",
      route: "/api/aliased-members",
      summary: "List aliased members",
      description: "List members from an aliased endpoint spec",
      securityScheme: "admin",
    });
    expect(contract.endpoints[0]?.response?.text).toBe("MemberDto[]");
    expect(contract.endpoints[0]?.errors).toEqual([
      expect.objectContaining({
        status: 404,
        description: "Members not found",
      }),
    ]);
  });

  it("extracts contracts from a temp consumer entry without requiring local node ambient types", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-consumer-"));
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );

    await fs.writeFile(
      entryPath,
      [
        `import type { Contract, Endpoint } from "${normalizedImportPath}";`,
        "",
        'export interface TempContract extends Contract<"TempContract"> {',
        "  Ping: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/ping";',
        "    response: void;",
        "  }>;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const bundle = await useCase.execute({ entryPath });

    expect(bundle.hasErrors).toBe(false);
    expect(bundle.diagnostics).toEqual([]);
    expect(bundle.contracts).toHaveLength(1);
    expect(bundle.contracts[0]?.name).toBe("TempContract");
  });

  it("reports compiler diagnostics when endpoint metadata includes unsupported keys", async () => {
    const frontend = new TypeScriptContractFrontend();
    const useCase = new ExtractTsContracts(frontend);

    const bundle = await useCase.execute({
      entryPath: getFixturePath(path.join("invalid-authoring-contract", "contracts.ts")),
    });

    expect(bundle.hasErrors).toBe(true);
    expect(bundle.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.stringMatching(/^TS\d+$/),
          filePath: expect.stringContaining(
            path.join("tests", "fixtures", "invalid-authoring-contract", "contracts.ts"),
          ),
          message: expect.stringContaining("topLevelExtra"),
        }),
        expect.objectContaining({
          code: expect.stringMatching(/^TS\d+$/),
          filePath: expect.stringContaining(
            path.join("tests", "fixtures", "invalid-authoring-contract", "contracts.ts"),
          ),
          message: expect.stringContaining("securityExtra"),
        }),
        expect.objectContaining({
          code: expect.stringMatching(/^TS\d+$/),
          filePath: expect.stringContaining(
            path.join("tests", "fixtures", "invalid-authoring-contract", "contracts.ts"),
          ),
          message: expect.stringContaining("errorExtra"),
        }),
      ]),
    );
  });
});
