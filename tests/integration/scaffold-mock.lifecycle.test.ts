import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/interfaces/cli/run-cli.js";
import {
  getProjectRoot,
  typecheckScaffoldedWorkspace,
} from "../support/scaffold-oracles.js";

const writeMembersFixture = async (sourceDirectory: string): Promise<string> => {
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.writeFile(path.join(sourceDirectory, "package.json"), '{ "type": "module" }\n');
  await fs.mkdir(path.join(sourceDirectory, "node_modules"), { recursive: true });
  await fs.symlink(getProjectRoot(), path.join(sourceDirectory, "node_modules", "rivet-ts"), "dir");

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

  const entryPath = path.join(sourceDirectory, "contracts.ts");
  await fs.writeFile(
    entryPath,
    [
      'import type { Contract, Endpoint } from "rivet-ts";',
      'import type { CreateMemberRequest, MemberDto, Page, PagedResult } from "./models.js";',
      'import { memberResponseExample } from "./models.js";',
      "",
      'export interface MembersContract extends Contract<"Members"> {',
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

  return entryPath;
};

const findFilesWithSuffix = async (root: string, suffixes: string[]): Promise<string[]> => {
  const hits: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") {
          await walk(entryPath);
        }
      } else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) {
        hits.push(entryPath);
      }
    }
  };
  await walk(root);
  return hits;
};

describe("scaffold-mock lifecycle", () => {
  it("scaffolds a golden-shape workspace with mock modules from the contract", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-scaffold-mock-"));
    const sourceDirectory = path.join(tempDirectory, "source");
    const outputDirectory = path.join(tempDirectory, "mock-app");
    const entryPath = await writeMembersFixture(sourceDirectory);

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(
      ["scaffold-mock", "--entry", entryPath, "--out", outputDirectory, "--name", "members-mock"],
      {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);

    const read = (relativePath: string) =>
      fs.readFile(path.join(outputDirectory, relativePath), "utf8");

    // Golden workspace shape: apps/ + packages/contracts, Taskfile-driven.
    const apiSource = path.join("apps", "api", "src");
    const taskfileSource = await read("Taskfile.yml");
    const rootPackageJsonSource = await read("package.json");
    const workspaceSource = await read("pnpm-workspace.yaml");
    const appSource = await read(path.join(apiSource, "app.ts"));
    const contractSource = await read(path.join(apiSource, "contract.ts"));
    const localSource = await read(path.join(apiSource, "local.ts"));
    const routesSource = await read(path.join(apiSource, "interface", "http", "members-routes.ts"));
    const listUseCaseSource = await read(
      path.join(apiSource, "modules", "members", "application", "list.ts"),
    );
    const createUseCaseSource = await read(
      path.join(apiSource, "modules", "members", "application", "create.ts"),
    );
    const nestedUseCaseSource = await read(
      path.join(apiSource, "modules", "members", "application", "nested.ts"),
    );
    const apiPackageJsonSource = await read(path.join("apps", "api", "package.json"));
    const contractsPackageJsonSource = await read(
      path.join("packages", "contracts", "package.json"),
    );
    const facadeSource = await read(path.join("packages", "contracts", "src", "index.ts"));
    const schemaSource = await read(path.join("packages", "contracts", "generated", "schema.d.ts"));
    const appVueSource = await read(path.join("apps", "ui", "app", "app.vue"));

    expect(workspaceSource).toContain("apps/*");
    expect(workspaceSource).toContain("packages/*");
    expect(rootPackageJsonSource).toContain('"packageManager": "pnpm@');

    // The generation pipeline runs through the rivet-ts binary passthrough —
    // never a bare `rivet` that exits 127 (GAPS 5.1).
    expect(taskfileSource).toContain(
      "rivet-ts --entry src/contracts.ts --out generated/api.contract.json",
    );
    expect(taskfileSource).toContain(
      "rivet-ts rivet -- --from generated/api.contract.json --output ../../packages/contracts/generated",
    );
    expect(taskfileSource).toContain("rivet-ts generate --generated-root");
    expect(taskfileSource).not.toMatch(/- rivet /u);
    expect(taskfileSource).toContain("plumb");

    // S3: the contract JSON imported by app.ts is written with the document.
    expect(appSource).toContain(
      'import contract from "../generated/api.contract.json" with { type: "json" };',
    );
    const contractJson = JSON.parse(
      await read(path.join("apps", "api", "generated", "api.contract.json")),
    ) as {
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

    // Suffix-free naming (Meridian §9.1): no tag-suffixed files anywhere.
    const taggedFiles = await findFilesWithSuffix(outputDirectory, [
      ".use-case.ts",
      ".handler.ts",
      ".service.ts",
      ".port.ts",
      ".provider.ts",
      ".interface.ts",
    ]);
    expect(taggedFiles).toEqual([]);

    // Routes register typed handlers per module; app composes the modules.
    expect(routesSource).toContain("registerRivetHonoRoutes<MembersContract>(app, contract, {");
    expect(routesSource).toContain('group: "members"');
    expect(routesSource).toContain('"List": () => list({}),');
    // Body-carrying endpoints parse at the edge before the mock runs.
    expect(routesSource).toContain('"Create": async (input) => {');
    expect(appSource).toContain("registerMembersRoutes(app, contract);");
    expect(appSource).toContain("app.onError");

    expect(listUseCaseSource).toContain("export const list = async");
    expect(listUseCaseSource).toContain('import type { MembersContract } from "#contract";');
    expect(listUseCaseSource).toContain("totalCount");

    // Example-backed mocks are emitted verbatim and therefore cast (S7).
    expect(createUseCaseSource).toContain('"id": "mem_001"');
    expect(createUseCaseSource).toContain("as CreateOutput");

    // S2: nested generics reusing the type-parameter name synthesize a
    // terminal mock value instead of overflowing the stack.
    expect(nestedUseCaseSource).toContain("export const nested = async");
    expect(nestedUseCaseSource).toContain('"value"');
    expect(nestedUseCaseSource).toContain('"email": "example"');
    expect(nestedUseCaseSource).not.toContain("TODO");

    // S4: every reference derives from where the entry actually lands.
    expect(contractSource).toContain('export type { MembersContract } from "./contracts.js";');
    expect(localSource).toContain('export { app } from "./app.js";');
    expect(apiPackageJsonSource).toContain('"#contract": "./src/contract.ts"');
    expect(apiPackageJsonSource).toContain('"./local": "./src/local.ts"');

    // RV-020 v2: the artifact dir holds exactly openapi.json + schema.d.ts;
    // the facade is hand-owned in src/.
    const generatedEntries = await fs.readdir(
      path.join(outputDirectory, "packages", "contracts", "generated"),
    );
    expect(generatedEntries.sort()).toEqual(["openapi.json", "schema.d.ts"]);
    expect(schemaSource).toContain("auto-generated by openapi-typescript");
    expect(facadeSource).toContain("export const configureRivet");
    expect(contractsPackageJsonSource).toContain('"./src/index.ts"');
    expect(contractsPackageJsonSource).toContain('"openapi-fetch"');
    expect(contractsPackageJsonSource).not.toContain('"zod"');

    // The UI demo call handles { data, error } (openapi-fetch never throws).
    expect(appVueSource).toContain('client.GET("/api/members")');
    expect(appVueSource).toContain("error");

    // Synthesized Zod schemas: emitted once from the IR, locked to the
    // contract type when synthesis is exact, parsed at the route edge.
    const validationSource = await read(
      path.join(apiSource, "interface", "validation", "members.ts"),
    );
    expect(validationSource).toContain("export const createRequest = z.object(");
    expect(validationSource).toContain('satisfies z.ZodType<RivetHandlerInput<MembersContract, "Create">["body"]>');
    expect(routesSource).toContain("createRequest.safeParse(input.body)");
    expect(routesSource).toContain("rivetHttpError(422");
    const validationIndexSource = await read(
      path.join(apiSource, "interface", "validation", "index.ts"),
    );
    expect(validationIndexSource).toContain('"./members.js"');

    // S8/T6: the scaffolded rivet-ts pin tracks this package's version.
    const { version: rivetTsVersion } = JSON.parse(
      await fs.readFile(path.join(getProjectRoot(), "package.json"), "utf8"),
    ) as { version: string };
    expect(apiPackageJsonSource).toContain(
      `"rivet-ts": "github:maxanstey-meridian/rivet-ts#v${rivetTsVersion}"`,
    );

    await typecheckScaffoldedWorkspace(outputDirectory);
  }, 120000);

  it("scaffolds one module per contract when multiple contracts are authored together", async () => {
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "rivet-ts-scaffold-mock-multi-"),
    );
    const sourceDirectory = path.join(tempDirectory, "source");
    const outputDirectory = path.join(tempDirectory, "mock-app");
    await fs.mkdir(sourceDirectory, { recursive: true });

    // Both contracts declare an endpoint named Get (the S1 repro). Per-module
    // routes files mean the two handlers can never collide in one import
    // scope; the tsc oracle keeps it that way.
    await fs.writeFile(
      path.join(sourceDirectory, "contracts.ts"),
      [
        'import type { Contract, Endpoint } from "rivet-ts";',
        "",
        "export interface PetDto {",
        "  id: string;",
        "  name: string;",
        "}",
        "",
        "export interface SummaryDto {",
        "  total: number;",
        "}",
        "",
        'export interface PetContract extends Contract<"Pet"> {',
        "  Get: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/pets/current";',
        "    response: PetDto;",
        "  }>;",
        "}",
        "",
        'export interface SummaryContract extends Contract<"Summary"> {',
        "  Get: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/summary";',
        "    response: SummaryDto;",
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
      "--name",
      "multi-mock",
    ]);

    expect(exitCode).toBe(0);

    const apiSource = path.join(outputDirectory, "apps", "api", "src");
    const appSource = await fs.readFile(path.join(apiSource, "app.ts"), "utf8");
    const petRoutesSource = await fs.readFile(
      path.join(apiSource, "interface", "http", "pet-routes.ts"),
      "utf8",
    );
    const summaryRoutesSource = await fs.readFile(
      path.join(apiSource, "interface", "http", "summary-routes.ts"),
      "utf8",
    );

    expect(appSource).toContain("registerPetRoutes(app, contract);");
    expect(appSource).toContain("registerSummaryRoutes(app, contract);");
    expect(petRoutesSource).toContain('group: "pet"');
    expect(summaryRoutesSource).toContain('group: "summary"');
    expect(petRoutesSource).toContain('"Get": () => get({}),');
    await expect(
      fs.stat(path.join(apiSource, "modules", "pet", "application", "get.ts")),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(apiSource, "modules", "summary", "application", "get.ts")),
    ).resolves.toBeTruthy();

    await typecheckScaffoldedWorkspace(outputDirectory);
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
        'export interface HelloContract extends Contract<"Hello"> {',
        "  Ping: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/ping";',
        '    response: { message: "pong" };',
        "  }>;",
        "}",
        "",
      ].join("\n"),
    );

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
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);

    await expect(
      fs.stat(path.join(outputDirectory, "apps", "api", "src", "app.ts")),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(outputDirectory, "packages", "contracts", "generated", "openapi.json")),
    ).resolves.toBeTruthy();
  }, 60000);

  it("enriches scaffolded validators with spec constraints when --spec is passed", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-scaffold-mock-spec-"));
    const sourceDirectory = path.join(tempDirectory, "source");
    const outputDirectory = path.join(tempDirectory, "mock-app");
    await fs.mkdir(sourceDirectory, { recursive: true });

    await fs.writeFile(
      path.join(sourceDirectory, "contracts.ts"),
      [
        'import type { Contract, Endpoint } from "rivet-ts";',
        "",
        "export interface CreateWidgetRequest {",
        "  name: string;",
        "  quantity: number;",
        "  tags: string[];",
        "  nickname: string | null;",
        "}",
        "",
        "export interface WidgetDto {",
        "  id: string;",
        "}",
        "",
        'export interface WidgetsContract extends Contract<"Widgets"> {',
        "  Create: Endpoint<{",
        '    method: "POST";',
        '    route: "/api/widgets";',
        "    input: CreateWidgetRequest;",
        "    response: WidgetDto;",
        "    successStatus: 201;",
        "  }>;",
        "}",
        "",
      ].join("\n"),
    );

    // Shaped like the Rivet binary's real openapi.json: named components,
    // constraints as sibling keywords on the property schemas.
    const specPath = path.join(sourceDirectory, "openapi.json");
    await fs.writeFile(
      specPath,
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "widgets", version: "0.0.0" },
        paths: {},
        components: {
          schemas: {
            CreateWidgetRequest: {
              type: "object",
              properties: {
                name: { type: "string", minLength: 3, maxLength: 20 },
                quantity: { type: "number", minimum: 1, maximum: 100 },
                tags: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 1,
                  maxItems: 3,
                  uniqueItems: true,
                },
                nickname: { type: ["string", "null"], minLength: 2 },
              },
              required: ["name", "quantity", "tags", "nickname"],
            },
          },
        },
      }),
    );

    const stderr: string[] = [];
    const exitCode = await runCli(
      [
        "scaffold-mock",
        "--entry",
        path.join(sourceDirectory, "contracts.ts"),
        "--out",
        outputDirectory,
        "--name",
        "widgets-mock",
        "--spec",
        specPath,
      ],
      {
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);

    const validationPath = path.join(
      outputDirectory,
      "apps",
      "api",
      "src",
      "interface",
      "validation",
      "widgets.ts",
    );
    const validationSource = await fs.readFile(validationPath, "utf8");

    expect(validationSource).toContain('"name": z.string().min(3).max(20)');
    expect(validationSource).toContain('"quantity": z.number().gte(1).lte(100)');
    expect(validationSource).toContain('"tags": z.array(z.string()).min(1).max(3).refine(');
    expect(validationSource).toContain('"nickname": z.string().min(2).nullable()');
    // Constraint chains never change the output TYPE, so the exactness lock
    // must survive the enrichment.
    expect(validationSource).toContain(
      'satisfies z.ZodType<RivetHandlerInput<WidgetsContract, "Create">["body"]>',
    );

    // The enriched constraints round-trip onto the wire contract JSON, which
    // must stay wire-legal (tsPropertyConstraints is part of the schema).
    const contractJson = JSON.parse(
      await fs.readFile(
        path.join(outputDirectory, "apps", "api", "generated", "api.contract.json"),
        "utf8",
      ),
    ) as { types: Array<{ name: string; properties?: Array<Record<string, unknown>> }> };
    const requestType = contractJson.types.find((type) => type.name === "CreateWidgetRequest");
    expect(requestType?.properties?.find((property) => property.name === "name")).toMatchObject({
      constraints: { minLength: 3, maxLength: 20 },
    });

    // The constrained validation file must COMPILE and the schema must
    // actually enforce the constraints at runtime.
    await typecheckScaffoldedWorkspace(outputDirectory);

    const { createRequest } = (await import(validationPath)) as {
      createRequest: { safeParse: (value: unknown) => { success: boolean } };
    };
    expect(
      createRequest.safeParse({ name: "Widget", quantity: 10, tags: ["a"], nickname: null })
        .success,
    ).toBe(true);
    expect(
      createRequest.safeParse({ name: "ab", quantity: 10, tags: ["a"], nickname: null }).success,
    ).toBe(false);
    expect(
      createRequest.safeParse({ name: "Widget", quantity: 0, tags: ["a"], nickname: null }).success,
    ).toBe(false);
    expect(
      createRequest.safeParse({ name: "Widget", quantity: 10, tags: ["a", "a"], nickname: null })
        .success,
    ).toBe(false);
    expect(
      createRequest.safeParse({ name: "Widget", quantity: 10, tags: ["a"], nickname: "x" }).success,
    ).toBe(false);
  }, 120000);

  it("refuses to overwrite a non-empty output directory unless --force is passed (S6)", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-scaffold-mock-rerun-"));
    const sourceDirectory = path.join(tempDirectory, "source");
    const outputDirectory = path.join(tempDirectory, "mock-app");
    const entryPath = await writeMembersFixture(sourceDirectory);

    const firstRun = await runCli([
      "scaffold-mock",
      "--entry",
      entryPath,
      "--out",
      outputDirectory,
    ]);
    expect(firstRun).toBe(0);

    const appPath = path.join(outputDirectory, "apps", "api", "src", "app.ts");
    const userEdit = "// user edit that must survive a forceless re-run\n";
    await fs.writeFile(appPath, userEdit);

    const stderr: string[] = [];
    const secondRun = await runCli(
      ["scaffold-mock", "--entry", entryPath, "--out", outputDirectory],
      {
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
      },
    );

    expect(secondRun).toBe(1);
    expect(stderr.join("")).toContain("--force");
    await expect(fs.readFile(appPath, "utf8")).resolves.toBe(userEdit);

    const forcedRun = await runCli([
      "scaffold-mock",
      "--entry",
      entryPath,
      "--out",
      outputDirectory,
      "--force",
    ]);
    expect(forcedRun).toBe(0);
    const regenerated = await fs.readFile(appPath, "utf8");
    expect(regenerated).not.toBe(userEdit);
    expect(regenerated).toContain("registerMembersRoutes(app, contract);");
  }, 120000);
});
