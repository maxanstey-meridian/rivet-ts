import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runCli } from "../../src/interfaces/cli/run-cli.js";

const execFileAsync = promisify(execFile);

const getProjectRoot = (): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "..");
};

/**
 * Real compilation oracle for scaffold output: link the runtime deps into the
 * scaffolded workspace and typecheck the generated api package with tsc.
 * Catches non-compiling output (duplicate handler imports, dangling contract
 * JSON imports, bad mock values) that string greps never could.
 */
const typecheckScaffoldedApi = async (outputDirectory: string): Promise<void> => {
  const nodeModulesDirectory = path.join(outputDirectory, "node_modules");
  await fs.mkdir(nodeModulesDirectory, { recursive: true });
  await fs.symlink(getProjectRoot(), path.join(nodeModulesDirectory, "rivet-ts"), "dir");
  await fs.symlink(
    path.join(getProjectRoot(), "node_modules", "hono"),
    path.join(nodeModulesDirectory, "hono"),
    "dir",
  );

  const tscPath = path.join(getProjectRoot(), "node_modules", ".bin", "tsc");

  try {
    await execFileAsync(tscPath, [
      "--noEmit",
      "-p",
      path.join(outputDirectory, "packages", "api", "tsconfig.json"),
    ]);
  } catch (error: unknown) {
    const failure = error as { stdout?: string; stderr?: string };
    throw new Error(
      `Scaffolded api package failed tsc --noEmit:\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`,
    );
  }
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
        "// S2 repro: nested generics reusing the same type-parameter name. Mock",
        "// synthesis must resolve the inner T against the outer frame instead of",
        "// recursing forever.",
        "export interface Wrapper<T> {",
        "  value: T;",
        "}",
        "",
        "export interface Page<T> {",
        "  data: Wrapper<T>;",
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
        'import type { CreateMemberRequest, MemberDto, Page, PagedResult } from "./models.js";',
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
        "",
        "  Nested: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/members/nested";',
        "    response: Page<MemberDto>;",
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
    expect(rootPackageJsonSource).toContain('"@types/node": "^25.5.2"');
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
    expect(uiMainSource).toContain('import { client } from "@members-mock/client";');
    expect(uiMainSource).toContain('import { configureLocalRivet } from "../rivet-local";');
    expect(uiMainSource).toContain("configureLocalRivet()");
    expect(uiMainSource).toContain('client.GET("/api/members")');
    expect(uiLocalRivetSource).toContain(
      'import { configureRivet, type RivetConfig } from "@members-mock/client";',
    );
    expect(uiLocalRivetSource).toContain('import { app } from "@members-mock/api/local";');
    expect(uiLocalRivetSource).toContain("app.request");
    // S3: the contract JSON imported by app.ts must actually be written by the
    // scaffold, with the lowered document inside it.
    expect(appSource).toContain('import contract from "../generated/api.contract.json";');
    const contractJsonSource = await fs.readFile(
      path.join(outputDirectory, "packages", "api", "generated", "api.contract.json"),
      "utf8",
    );
    const contractJson = JSON.parse(contractJsonSource) as {
      types: Array<{ name: string }>;
      endpoints: Array<{ name: string; httpMethod: string; routeTemplate: string }>;
    };
    expect(contractJson.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "create",
          httpMethod: "POST",
          routeTemplate: "/api/members",
        }),
        expect.objectContaining({
          name: "remove",
          httpMethod: "DELETE",
          routeTemplate: "/api/members/{id}",
        }),
      ]),
    );
    expect(contractJson.types).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "MemberDto" })]),
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
    // The binary emits the OpenAPI spec the client types derive from; the path
    // is resolved against --output, landing in ../client/generated/openapi.json.
    expect(apiPackageJsonSource).toContain("--openapi ../openapi.json");
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
    expect(clientPackageJsonSource).toContain('"openapi-fetch"');
    expect(clientPackageJsonSource).toContain('"zod": "^4.1.12"');

    // S8/T6: the scaffolded rivet-ts dependency pin must track this package's
    // version instead of drifting behind it.
    const { version: rivetTsVersion } = JSON.parse(
      await fs.readFile(path.join(getProjectRoot(), "package.json"), "utf8"),
    ) as { version: string };
    const expectedRivetTsDependency = `"rivet-ts": "github:maxanstey-meridian/rivet-ts#v${rivetTsVersion}"`;
    expect(rootPackageJsonSource).toContain(expectedRivetTsDependency);
    expect(apiPackageJsonSource).toContain(expectedRivetTsDependency);
    expect(clientPackageJsonSource).toContain(expectedRivetTsDependency);

    // S2: nested generics reusing the type-parameter name must synthesize a
    // terminal mock value instead of overflowing the stack.
    const nestedUseCaseSource = await fs.readFile(
      path.join(
        outputDirectory,
        "packages",
        "api",
        "src",
        "modules",
        "members",
        "application",
        "nested.use-case.ts",
      ),
      "utf8",
    );
    expect(nestedUseCaseSource).toContain("export const executeNested");
    expect(nestedUseCaseSource).toContain('"data"');
    expect(nestedUseCaseSource).toContain('"value"');
    expect(nestedUseCaseSource).toContain('"email": "example"');
    expect(nestedUseCaseSource).not.toContain("TODO");
    await expect(
      fs.stat(
        path.join(outputDirectory, "packages", "api", "test", "architecture.boundaries.test.ts"),
      ),
    ).rejects.toThrow();
    // Invoke the depcruise bin directly: `pnpm exec` pollutes stderr with
    // settings warnings under pnpm >= 11, breaking the empty-stderr oracle.
    await expect(
      execFileAsync(path.join(getProjectRoot(), "node_modules", ".bin", "depcruise"), [
        "--config",
        path.join(outputDirectory, ".dependency-cruiser.cjs"),
        "--ts-config",
        path.join(outputDirectory, "tsconfig.json"),
        path.join(outputDirectory, "packages", "api", "src"),
      ]),
    ).resolves.toMatchObject({ stderr: "" });

    // Bootstrap client chain: the scaffold itself writes openapi.json (routes
    // only) and derives schema.d.ts + index.ts from it so the ui's client
    // import resolves before the first real generate run.
    const generatedClientRoot = path.join(outputDirectory, "packages", "client", "generated");
    const bootstrapSpec = JSON.parse(
      await fs.readFile(path.join(generatedClientRoot, "openapi.json"), "utf8"),
    ) as { openapi: string; paths: Record<string, Record<string, unknown>> };
    expect(bootstrapSpec.openapi).toBe("3.1.0");
    expect(Object.keys(bootstrapSpec.paths)).toEqual(
      expect.arrayContaining(["/api/members", "/api/members/{id}", "/api/members/nested"]),
    );
    expect(bootstrapSpec.paths["/api/members"]).toHaveProperty("get");
    expect(bootstrapSpec.paths["/api/members"]).toHaveProperty("post");
    expect(bootstrapSpec.paths["/api/members/{id}"]).toHaveProperty("delete");

    const bootstrapSchemaSource = await fs.readFile(
      path.join(generatedClientRoot, "schema.d.ts"),
      "utf8",
    );
    expect(bootstrapSchemaSource).toContain("export interface paths");
    expect(bootstrapSchemaSource).toContain('"/api/members"');

    // `rivet-ts generate` over the same root is the generate-script path; it
    // must succeed and leave the same facade in place.
    await expect(runCli(["generate", "--generated-root", generatedClientRoot])).resolves.toBe(0);

    const clientEntrySource = await fs.readFile(path.join(generatedClientRoot, "index.ts"), "utf8");
    expect(clientEntrySource).toContain(
      'import createOpenApiClient, { type Client, type ClientOptions } from "openapi-fetch";',
    );
    expect(clientEntrySource).toContain("export const configureRivet = (config: RivetConfig)");
    expect(clientEntrySource).not.toContain("rivetFetch");

    // II.B-1: the scaffolded api package must actually compile.
    await typecheckScaffoldedApi(outputDirectory);
  }, 120000);

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

    // S1: both contracts declare an endpoint named Get; app.ts must qualify the
    // two handler imports distinctly or it does not compile.
    expect(appSource).toContain(
      'import { getHandler as petGetHandler } from "./modules/pet/interface/http/get.handler.js";',
    );
    expect(appSource).toContain(
      'import { getHandler as summaryGetHandler } from "./modules/summary/interface/http/get.handler.js";',
    );
    expect(appSource).toContain("Get: petGetHandler,");
    expect(appSource).toContain("Get: summaryGetHandler,");

    await typecheckScaffoldedApi(outputDirectory);
  }, 120000);

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

    await typecheckScaffoldedApi(outputDirectory);
  }, 120000);

  // S6: re-running scaffold-mock over an existing directory overwrites emitted
  // files unconditionally. That is the defined (if blunt) behavior — pin it so
  // any future --force/skip-existing semantics land as a deliberate change.
  it("clobbers previously scaffolded files when re-run over the same output directory", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-scaffold-mock-rerun-"));
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
        "    response: { message: string };",
        "  }>;",
        "}",
        "",
      ].join("\n"),
    );

    const scaffoldArgs = [
      "scaffold-mock",
      "--entry",
      path.join(sourceDirectory, "contracts.ts"),
      "--out",
      outputDirectory,
    ];

    await expect(runCli(scaffoldArgs)).resolves.toBe(0);

    const appPath = path.join(outputDirectory, "packages", "api", "src", "app.ts");
    const originalAppSource = await fs.readFile(appPath, "utf8");
    await fs.writeFile(appPath, "// user edit that will be clobbered\n");

    await expect(runCli(scaffoldArgs)).resolves.toBe(0);

    const rescaffoldedAppSource = await fs.readFile(appPath, "utf8");
    expect(rescaffoldedAppSource).not.toContain("user edit that will be clobbered");
    expect(rescaffoldedAppSource).toBe(originalAppSource);
  }, 60000);
});
