import { Hono } from "hono";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { registerRivetHonoRoutes } from "../../src/hono.js";
import type { Contract, Endpoint, RivetHandler } from "../../src/index.js";
import { runCli } from "../../src/interfaces/cli/run-cli.js";

const execFileAsync = promisify(execFile);

const getProjectRoot = (): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "..");
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

    await expect(
      fs.stat(path.join(outputDirectory, "packages", "api", "src", "app", "contracts.ts")),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(outputDirectory, "packages", "api", "src", "app", "models.ts")),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(outputDirectory, "packages", "api", "src", "main.ts")),
    ).rejects.toThrow();
    await expect(
      fs.stat(path.join(outputDirectory, "packages", "api", "index.html")),
    ).rejects.toThrow();

    const rootPackageJsonSource = await fs.readFile(
      path.join(outputDirectory, "package.json"),
      "utf8",
    );
    const workspaceSource = await fs.readFile(
      path.join(outputDirectory, "pnpm-workspace.yaml"),
      "utf8",
    );
    const rootViteConfigSource = await fs.readFile(
      path.join(outputDirectory, "vite.config.ts"),
      "utf8",
    );
    const rootTsconfigSource = await fs.readFile(
      path.join(outputDirectory, "tsconfig.json"),
      "utf8",
    );
    const dependencyCruiserConfigSource = await fs.readFile(
      path.join(outputDirectory, ".dependency-cruiser.cjs"),
      "utf8",
    );
    const uiMainSource = await fs.readFile(
      path.join(outputDirectory, "ui", "src", "main.ts"),
      "utf8",
    );
    const uiLocalRivetSource = await fs.readFile(
      path.join(outputDirectory, "ui", "rivet-local.ts"),
      "utf8",
    );
    const appSource = await fs.readFile(
      path.join(outputDirectory, "packages", "api", "src", "app.ts"),
      "utf8",
    );
    const authModuleSource = await fs.readFile(
      path.join(
        outputDirectory,
        "packages",
        "api",
        "src",
        "modules",
        "members",
        "members.module.ts",
      ),
      "utf8",
    );
    const listUseCaseSource = await fs.readFile(
      path.join(
        outputDirectory,
        "packages",
        "api",
        "src",
        "modules",
        "members",
        "application",
        "list.use-case.ts",
      ),
      "utf8",
    );
    const createHandlerSource = await fs.readFile(
      path.join(
        outputDirectory,
        "packages",
        "api",
        "src",
        "modules",
        "members",
        "interface",
        "http",
        "create.handler.ts",
      ),
      "utf8",
    );
    const mapContractErrorSource = await fs.readFile(
      path.join(outputDirectory, "packages", "api", "src", "app", "map-contract-error.ts"),
      "utf8",
    );
    const compositionSource = await fs.readFile(
      path.join(outputDirectory, "packages", "api", "src", "app", "composition.ts"),
      "utf8",
    );
    const contractSource = await fs.readFile(
      path.join(outputDirectory, "packages", "api", "src", "app", "contract.ts"),
      "utf8",
    );
    const localSource = await fs.readFile(
      path.join(outputDirectory, "packages", "api", "src", "app", "local.ts"),
      "utf8",
    );
    const apiPackageJsonSource = await fs.readFile(
      path.join(outputDirectory, "packages", "api", "package.json"),
      "utf8",
    );
    const clientPackageJsonSource = await fs.readFile(
      path.join(outputDirectory, "packages", "client", "package.json"),
      "utf8",
    );

    expect(workspaceSource).toContain("packages/*");
    expect(rootPackageJsonSource).toContain('"dev": "vite"');
    expect(rootPackageJsonSource).toContain('"generate": "pnpm --dir packages/api run generate"');
    expect(rootPackageJsonSource).toContain('"check": "tsc --noEmit"');
    expect(rootPackageJsonSource).toContain(
      '"check:architecture": "depcruise --config .dependency-cruiser.cjs --ts-config tsconfig.json packages/api/src"',
    );
    expect(rootPackageJsonSource).toContain(
      '"test": "pnpm run check && pnpm run check:architecture"',
    );
    expect(rootPackageJsonSource).toContain('"@members-mock/api": "workspace:*"');
    expect(rootPackageJsonSource).toContain('"@members-mock/client": "workspace:*"');
    expect(rootPackageJsonSource).toContain('"dependency-cruiser": "^17.3.10"');
    expect(rootViteConfigSource).toContain('import { rivetTs } from "rivet-ts/vite";');
    expect(rootViteConfigSource).toContain('entry: "./packages/api/src/app/contracts.ts"');
    expect(rootViteConfigSource).toContain('clientOutDir: "./packages/client/generated"');
    expect(rootViteConfigSource).not.toContain('app: "./packages/api/src/app.ts"');
    expect(dependencyCruiserConfigSource).toContain('name: "no-feature-to-feature"');
    expect(dependencyCruiserConfigSource).toContain('name: "no-api-to-client"');
    expect(dependencyCruiserConfigSource).toContain('path: "^node_modules"');
    expect(dependencyCruiserConfigSource).toContain('fileName: "tsconfig.json"');
    expect(rootTsconfigSource).toContain('"baseUrl": "."');
    expect(rootTsconfigSource).toContain('"@members-mock/client"');
    expect(rootTsconfigSource).toContain('"./packages/client/generated/index.ts"');
    expect(rootTsconfigSource).toContain('"@members-mock/api/local"');
    expect(rootTsconfigSource).toContain('"./packages/api/src/app/local.ts"');
    expect(uiMainSource).toContain('import { members } from "@members-mock/client";');
    expect(uiMainSource).toContain('import { configureLocalRivet } from "../rivet-local";');
    expect(uiMainSource).toContain("configureLocalRivet()");
    expect(uiMainSource).toContain("members.list()");
    expect(uiLocalRivetSource).toContain(
      'import { configureRivet, type RivetConfig } from "@members-mock/client";',
    );
    expect(uiLocalRivetSource).toContain('import { app } from "@members-mock/api/local";');
    expect(uiLocalRivetSource).toContain("app.request");
    expect(appSource).toContain('import contract from "../generated/api.contract.json";');
    expect(appSource).toContain('import { compose } from "./app/composition.js";');
    expect(appSource).toContain(
      'import { tryMapContractError } from "./app/map-contract-error.js";',
    );
    expect(appSource).toContain("compose();");
    expect(appSource).toContain('import type { MembersContract } from "#contract";');
    expect(appSource).toContain("registerRivetHonoRoutes<MembersContract>(app, contract, {");
    expect(appSource).toContain('group: "members"');
    expect(authModuleSource).toContain("export const registerMembersModule = (): void => {");
    expect(authModuleSource).toContain("Module composition root goes here.");
    expect(listUseCaseSource).toContain("totalCount");
    expect(listUseCaseSource).toContain("export const executeList");
    expect(listUseCaseSource).toContain('import type { MembersContract } from "#contract";');
    expect(listUseCaseSource).toContain('"items": [');
    expect(createHandlerSource).toContain("export const createHandler");
    expect(createHandlerSource).toContain("executeCreate");
    expect(createHandlerSource).toContain('import type { MembersContract } from "#contract";');
    expect(createHandlerSource).toContain("async (input) => {");
    expect(createHandlerSource).toContain("return executeCreate(input);");
    expect(createHandlerSource).not.toContain("=> executeCreate(input)");
    expect(mapContractErrorSource).toContain("App-level transport error hook.");
    expect(compositionSource).toContain("../modules/members/members.module.js");
    expect(contractSource).toContain('export type { MembersContract } from "./contracts.js";');
    expect(localSource).toContain('export { app } from "../app.js";');
    expect(apiPackageJsonSource).toContain(
      "src/app/contracts.ts --out generated/api.contract.json",
    );
    expect(apiPackageJsonSource).toContain(
      "pnpm exec rivet-ts generate --generated-root ../client/generated",
    );
    await expect(
      fs.stat(path.join(outputDirectory, "scripts", "generate-client-entry.mjs")),
    ).rejects.toThrow();
    expect(apiPackageJsonSource).toContain('"#contract": "./src/app/contract.ts"');
    expect(apiPackageJsonSource).toContain('"./local": "./src/app/local.ts"');
    expect(clientPackageJsonSource).toContain('"name": "@members-mock/client"');
    expect(clientPackageJsonSource).toContain('"."');
    expect(clientPackageJsonSource).toContain('"zod": "^4.1.12"');
    await expect(
      fs.stat(
        path.join(outputDirectory, "packages", "api", "test", "architecture.boundaries.test.ts"),
      ),
    ).rejects.toThrow();
    await expect(
      execFileAsync("pnpm", [
        "--dir",
        getProjectRoot(),
        "exec",
        "depcruise",
        "--config",
        path.join(outputDirectory, ".dependency-cruiser.cjs"),
        "--ts-config",
        path.join(outputDirectory, "tsconfig.json"),
        path.join(outputDirectory, "packages", "api", "src"),
      ]),
    ).resolves.toMatchObject({ stderr: "" });

    const generatedClientRoot = path.join(outputDirectory, "packages", "client", "generated");
    await fs.mkdir(path.join(generatedClientRoot, "rivet", "client"), { recursive: true });
    await fs.mkdir(path.join(generatedClientRoot, "rivet", "types"), { recursive: true });
    await fs.writeFile(
      path.join(generatedClientRoot, "rivet", "client", "members.ts"),
      "export const list = () => null;\n",
    );
    await fs.writeFile(
      path.join(generatedClientRoot, "rivet", "rivet.ts"),
      "export const configureRivet = () => undefined;\n",
    );
    await fs.writeFile(
      path.join(generatedClientRoot, "rivet", "types", "common.ts"),
      "export type MemberDto = { id: string };\n",
    );
    await fs.writeFile(
      path.join(generatedClientRoot, "rivet", "schemas.ts"),
      "export const memberSchema = {};\n",
    );
    await fs.writeFile(
      path.join(generatedClientRoot, "rivet", "validators.ts"),
      "export const validateMember = () => true;\n",
    );

    await expect(runCli(["generate", "--generated-root", generatedClientRoot])).resolves.toBe(0);

    const clientEntrySource = await fs.readFile(path.join(generatedClientRoot, "index.ts"), "utf8");
    expect(clientEntrySource).toContain('export * as schemas from "./rivet/schemas.js";');
    expect(clientEntrySource).toContain('export * as validators from "./rivet/validators.js";');
  });

  it("scaffolds one module per contract when multiple contracts are authored together", async () => {
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

    const compositionSource = await fs.readFile(
      path.join(outputDirectory, "packages", "api", "src", "app", "composition.ts"),
      "utf8",
    );
    const petModuleSource = await fs.readFile(
      path.join(outputDirectory, "packages", "api", "src", "modules", "pet", "pet.module.ts"),
      "utf8",
    );
    const summaryModuleSource = await fs.readFile(
      path.join(
        outputDirectory,
        "packages",
        "api",
        "src",
        "modules",
        "summary",
        "summary.module.ts",
      ),
      "utf8",
    );
    const petHandlerSource = await fs.readFile(
      path.join(
        outputDirectory,
        "packages",
        "api",
        "src",
        "modules",
        "pet",
        "interface",
        "http",
        "get.handler.ts",
      ),
      "utf8",
    );
    const summaryHandlerSource = await fs.readFile(
      path.join(
        outputDirectory,
        "packages",
        "api",
        "src",
        "modules",
        "summary",
        "interface",
        "http",
        "get.handler.ts",
      ),
      "utf8",
    );
    const appSource = await fs.readFile(
      path.join(outputDirectory, "packages", "api", "src", "app.ts"),
      "utf8",
    );

    expect(compositionSource).toContain("registerCommonModule();");
    expect(compositionSource).toContain("registerPetModule();");
    expect(compositionSource).toContain("registerSummaryModule();");
    expect(petModuleSource).toContain("Module composition root goes here.");
    expect(summaryModuleSource).toContain("Module composition root goes here.");
    expect(appSource).toContain('group: "pet"');
    expect(appSource).toContain('group: "summary"');
    expect(petHandlerSource).toContain("export const getHandler");
    expect(summaryHandlerSource).toContain("export const getHandler");
  });

  it("scaffolds from a bare contract file without tsconfig or node_modules", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-scaffold-mock-bare-"));
    const sourceDirectory = path.join(tempDirectory, "source");
    const outputDirectory = path.join(tempDirectory, "mock-app");
    await fs.mkdir(sourceDirectory, { recursive: true });

    await fs.writeFile(
      path.join(sourceDirectory, "contracts.ts"),
      [
        'import type { Contract, Endpoint } from "rivet-ts";',
        "",
        'export interface HelloContract extends Contract<"HelloContract"> {',
        "  Ping: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/ping";',
        '    response: { message: "pong" };',
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
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(0);

    const rootPackageJsonSource = await fs.readFile(
      path.join(outputDirectory, "package.json"),
      "utf8",
    );
    const appSource = await fs.readFile(
      path.join(outputDirectory, "packages", "api", "src", "app.ts"),
      "utf8",
    );
    const rootTsconfigSource = await fs.readFile(
      path.join(outputDirectory, "tsconfig.json"),
      "utf8",
    );
    const uiMainSource = await fs.readFile(
      path.join(outputDirectory, "ui", "src", "main.ts"),
      "utf8",
    );

    expect(rootPackageJsonSource).toContain('"dev": "vite"');
    expect(appSource).toContain("compose();");
    expect(appSource).toContain("registerRivetHonoRoutes<HelloContract>(app, contract, {");
    expect(rootTsconfigSource).toContain('"@mock-app/client"');
    expect(rootTsconfigSource).toContain('"@mock-app/api/local"');
    expect(uiMainSource).toContain("configureLocalRivet()");
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

    const pingHandler: RivetHandler<MultiContract, "Ping"> = async () => undefined;

    const app = new Hono();
    registerRivetHonoRoutes<MultiContract>(
      app,
      {
        endpoints: [
          {
            name: "ping",
            httpMethod: "POST",
            routeTemplate: "/api/ping",
            group: "pet",
            params: [],
            responses: [{ statusCode: 204 }],
          },
          {
            name: "health",
            httpMethod: "GET",
            routeTemplate: "/api/health",
            group: "summary",
            params: [],
            responses: [{ statusCode: 200 }],
          },
        ],
      },
      {
        handlers: {
          Ping: pingHandler,
        },
        group: "pet",
      },
    );

    const pingResponse = await app.request("http://local/api/ping", { method: "POST" });
    const healthResponse = await app.request("http://local/api/health", { method: "GET" });

    expect(pingResponse.status).toBe(204);
    expect(await pingResponse.text()).toBe("");
    expect(healthResponse.status).toBe(404);
  });
});
