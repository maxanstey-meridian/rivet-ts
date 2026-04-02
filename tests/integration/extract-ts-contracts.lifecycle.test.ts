import path from "node:path";
import { fileURLToPath } from "node:url";

import { ExtractTsContracts } from "../../src/application/use-cases/extract-ts-contracts.js";
import { TypeScriptContractFrontend } from "../../src/infrastructure/typescript/typescript-contract-frontend.js";

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
});
