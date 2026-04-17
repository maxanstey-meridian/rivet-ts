import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../../src/interfaces/cli/run-cli.js";
import { mount } from "../../src/hono.js";
import type { Contract, Endpoint, RivetHandler } from "../../src/index.js";

const getProjectRoot = (): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "..");
};

const toImportPath = (fromDirectory: string, targetFilePath: string): string => {
  const relativePath = path.relative(fromDirectory, targetFilePath).split(path.sep).join("/");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
};

describe("scaffold-mock lifecycle", () => {
  it("scaffolds a Hono mock project with example-backed and synthesized handlers", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-scaffold-mock-"));
    const sourceDirectory = path.join(tempDirectory, "source");
    const outputDirectory = path.join(tempDirectory, "mock-app");
    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.writeFile(path.join(sourceDirectory, "package.json"), '{ "type": "module" }\n');
    await fs.mkdir(path.join(sourceDirectory, "node_modules"), { recursive: true });
    await fs.symlink(
      getProjectRoot(),
      path.join(sourceDirectory, "node_modules", "rivet-ts"),
      "dir",
    );

    await fs.writeFile(
      path.join(sourceDirectory, "models.ts"),
      [
        "export interface CreateMemberRequest {",
        "  email: string;",
        "}",
        "",
        "export interface MemberDto {",
        "  id: string;",
        "  email: string;",
        "}",
        "",
        "export interface PagedResult<TItem> {",
        "  items: TItem[];",
        "  totalCount: number;",
        "}",
        "",
        "export const memberResponseExample = {",
        '  id: "mem_001",',
        '  email: "jane@example.com",',
        "} satisfies MemberDto;",
        "",
      ].join("\n"),
    );

    await fs.writeFile(
      path.join(sourceDirectory, "contracts.ts"),
      [
        'import type { Contract, Endpoint } from "rivet-ts";',
        'import type { CreateMemberRequest, MemberDto, PagedResult } from "./models.js";',
        'import { memberResponseExample } from "./models.js";',
        "",
        'export interface MembersContract extends Contract<"MembersContract"> {',
        "  List: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/members";',
        "    response: PagedResult<MemberDto>;",
        "  }>;",
        "",
        "  Create: Endpoint<{",
        '    method: "POST";',
        '    route: "/api/members";',
        "    input: CreateMemberRequest;",
        "    response: MemberDto;",
        "    successStatus: 201;",
        "    responseExamples: [{ status: 201; examples: [typeof memberResponseExample] }];",
        "  }>;",
        "",
        "  Remove: Endpoint<{",
        '    method: "DELETE";',
        '    route: "/api/members/{id}";',
        "    response: void;",
        "    successStatus: 204;",
        "  }>;",
        "}",
        "",
      ].join("\n"),
    );

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(
      [
        "scaffold-mock",
        "--entry",
        path.join(sourceDirectory, "contracts.ts"),
        "--out",
        outputDirectory,
        "--name",
        "members-mock",
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(0);

    await expect(fs.stat(path.join(outputDirectory, "src", "contract-source", "contracts.ts"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outputDirectory, "src", "contract-source", "models.ts"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outputDirectory, "src", "rivet-hono.ts"))).rejects.toThrow();

    const apiSource = await fs.readFile(path.join(outputDirectory, "src", "api.ts"), "utf8");
    const localRivetSource = await fs.readFile(
      path.join(outputDirectory, "src", "local-rivet.ts"),
      "utf8",
    );
    const listHandlerSource = await fs.readFile(
      path.join(outputDirectory, "src", "handlers", "list.ts"),
      "utf8",
    );
    const createHandlerSource = await fs.readFile(
      path.join(outputDirectory, "src", "handlers", "create.ts"),
      "utf8",
    );
    const removeHandlerSource = await fs.readFile(
      path.join(outputDirectory, "src", "handlers", "remove.ts"),
      "utf8",
    );
    const packageJsonSource = await fs.readFile(
      path.join(outputDirectory, "package.json"),
      "utf8",
    );

    expect(apiSource).toContain('import { mount } from "rivet-ts/hono";');
    expect(apiSource).toContain('{ controllerName: "members" }');
    expect(localRivetSource).toContain("export const configureLocalRivet");
    expect(localRivetSource).toContain("app.request");
    expect(listHandlerSource).toContain("totalCount");
    expect(listHandlerSource).toContain('"items": [');
    expect(createHandlerSource).toContain('"id": "mem_001"');
    expect(createHandlerSource).toContain('"email": "jane@example.com"');
    expect(removeHandlerSource).toContain("return undefined;");
    expect(packageJsonSource).toContain(
      "src/contract-source/contracts.ts --out generated/members-mock.contract.json",
    );
  });

  it("prefixes handler files when multiple contracts reuse endpoint names", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-scaffold-mock-dup-"));
    const sourceDirectory = path.join(tempDirectory, "source");
    const outputDirectory = path.join(tempDirectory, "mock-app");
    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.writeFile(path.join(sourceDirectory, "package.json"), '{ "type": "module" }\n');
    await fs.mkdir(path.join(sourceDirectory, "node_modules"), { recursive: true });
    await fs.symlink(
      getProjectRoot(),
      path.join(sourceDirectory, "node_modules", "rivet-ts"),
      "dir",
    );

    await fs.writeFile(
      path.join(sourceDirectory, "contracts.ts"),
      [
        'import type { Contract, Endpoint } from "rivet-ts";',
        "",
        'export interface PetContract extends Contract<"PetContract"> {',
        "  Get: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/pet";',
        "    response: { name: string };",
        "  }>;",
        "}",
        "",
        'export interface SummaryContract extends Contract<"SummaryContract"> {',
        "  Get: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/summary";',
        "    response: { body: string };",
        "  }>;",
        "}",
        "",
      ].join("\n"),
    );

    const exitCode = await runCli([
      "scaffold-mock",
      "--entry",
      path.join(sourceDirectory, "contracts.ts"),
      "--out",
      outputDirectory,
    ]);

    expect(exitCode).toBe(0);

    const apiSource = await fs.readFile(path.join(outputDirectory, "src", "api.ts"), "utf8");
    const petHandlerSource = await fs.readFile(
      path.join(outputDirectory, "src", "handlers", "pet-get.ts"),
      "utf8",
    );
    const summaryHandlerSource = await fs.readFile(
      path.join(outputDirectory, "src", "handlers", "summary-get.ts"),
      "utf8",
    );

    expect(apiSource).toContain('{ controllerName: "pet" }');
    expect(apiSource).toContain('{ controllerName: "summary" }');
    expect(petHandlerSource).toContain("export const petGet");
    expect(summaryHandlerSource).toContain("export const summaryGet");
  });

  it("filters controllers and returns empty responses correctly in rivet-ts/hono", async () => {
    interface MultiContract extends Contract<"MultiContract"> {
      Ping: Endpoint<{
        method: "POST";
        route: "/api/ping";
        response: void;
      }>;
      Health: Endpoint<{
        method: "GET";
        route: "/api/health";
        response: { status: "ok" };
      }>;
    }

    const handlers: {
      readonly Ping: RivetHandler<MultiContract, "Ping">;
      readonly Health: RivetHandler<MultiContract, "Health">;
    } = {
      Ping: async () => undefined,
      Health: async () => ({ status: "ok" }),
    };

    const app = mount<MultiContract>(
      {
        endpoints: [
          {
            name: "Ping",
            httpMethod: "POST",
            routeTemplate: "/api/ping",
            controllerName: "pet",
            params: [],
            responses: [{ statusCode: 204 }],
          },
          {
            name: "Health",
            httpMethod: "GET",
            routeTemplate: "/api/health",
            controllerName: "summary",
            params: [],
            responses: [{ statusCode: 200 }],
          },
        ],
      },
      handlers,
      { controllerName: "pet" },
    );

    const pingResponse = await app.request("http://local/api/ping", { method: "POST" });
    const healthResponse = await app.request("http://local/api/health", { method: "GET" });

    expect(pingResponse.status).toBe(204);
    expect(await pingResponse.text()).toBe("");
    expect(healthResponse.status).toBe(404);
  });
});
