import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveRivetBinaryConfig } from "../../src/config/rivet-binary.js";
import { RivetContractDocument } from "../../src/domain/rivet-contract.js";
import { emitMockProject } from "../../src/infrastructure/scaffold/mock-project-emitter.js";
import { lowerContracts } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { ensureRivetBinary } from "../../src/infrastructure/vite/rivet-binary.js";
import { runCliCaptured } from "../support/cli.js";
import { writeContractProject } from "../support/contract-project.js";
import { parseContractJson } from "../support/lower.js";
import {
  AUTHORING_TYPES,
  fixturePath,
  linkPackage,
  PACKAGE_NAME,
  PROJECT_ROOT,
} from "../support/paths.js";
import {
  PLUMB_EXECUTABLE,
  PLUMB_NOT_FOUND,
  plumbFindings,
  typecheckScaffoldedWorkspace,
} from "../support/scaffold-oracles.js";
import { tempDir } from "../support/temp.js";

const execFileAsync = promisify(execFile);

type ScaffoldedApp = {
  request: (input: string, init?: RequestInit) => Promise<Response>;
};

const MEMBERS_MODELS = `export interface CreateMemberRequest {
  email: string;
}

export interface MemberDto {
  id: string;
  email: string;
}

export interface PagedResult<TItem> {
  items: TItem[];
  totalCount: number;
}

// Nested generics reusing the same type-parameter name: mock synthesis must
// resolve the inner T against the outer frame instead of recursing forever.
export interface Wrapper<T> {
  value: T;
}

export interface Page<T> {
  data: Wrapper<T>;
}

export interface TreeDto {
  name: string;
  children: TreeDto[];
  childrenByName: Record<string, TreeDto>;
  parent: TreeDto | null;
  next?: TreeDto;
}

export const memberResponseExample = { id: "mem_001", email: "jane@example.com" } satisfies MemberDto;
export const exportResponseExample = "not-a-blob";
`;

const MEMBERS_CONTRACTS = `import type { Contract, Endpoint } from "@maxanstey-meridian/rivet-ts";
import type { CreateMemberRequest, MemberDto, Page, PagedResult, TreeDto } from "./models.js";
import { exportResponseExample, memberResponseExample } from "./models.js";

export interface MembersContract extends Contract<"Members"> {
  List: Endpoint<{ method: "GET"; route: "/api/members"; response: PagedResult<MemberDto> }>;

  Create: Endpoint<{
    method: "POST";
    route: "/api/members";
    input: CreateMemberRequest;
    response: MemberDto;
    successStatus: 201;
    responseExamples: [{ status: 201; examples: [typeof memberResponseExample] }];
  }>;

  Remove: Endpoint<{ method: "DELETE"; route: "/api/members/{id}"; response: void; successStatus: 204 }>;
  Nested: Endpoint<{ method: "GET"; route: "/api/members/nested"; response: Page<MemberDto> }>;
  Tree: Endpoint<{ method: "GET"; route: "/api/members/tree"; response: TreeDto }>;

  Export: Endpoint<{
    method: "GET";
    route: "/api/members/export";
    fileResponse: true;
    fileContentType: "text/csv";
    responseExamples: [{ status: 200; examples: [typeof exportResponseExample] }];
  }>;
}
`;

/**
 * Writes `files` into a throwaway source directory (with `rivet-ts` linked, as
 * an installed consumer has it) and runs `rivet-ts scaffold-mock` on its
 * `contracts.ts`.
 */
const scaffoldMock = async (
  files: Readonly<Record<string, string>>,
  extraArgs: readonly string[] = [],
) => {
  const root = await tempDir("rivet-ts-scaffold-mock-");
  const sourceDirectory = path.join(root, "source");
  await linkPackage(path.join(sourceDirectory, "node_modules"));
  for (const [name, content] of Object.entries({
    "package.json": '{ "type": "module" }\n',
    ...files,
  })) {
    await fs.writeFile(path.join(sourceDirectory, name), content);
  }
  const entryPath = path.join(sourceDirectory, "contracts.ts");
  const outputDirectory = path.join(root, "mock-app");
  const run = await runCliCaptured([
    "scaffold-mock",
    "--entry",
    entryPath,
    "--out",
    outputDirectory,
    ...extraArgs,
  ]);
  return { ...run, entryPath, outputDirectory };
};

const apiSourcePath = (outputDirectory: string, ...segments: readonly string[]) =>
  path.join(outputDirectory, "apps", "api", "src", ...segments);

/** The real compile oracle first, then the scaffolded app itself. */
const loadScaffoldedApp = async (outputDirectory: string): Promise<ScaffoldedApp> => {
  await typecheckScaffoldedWorkspace(outputDirectory);
  const { app } = (await import(apiSourcePath(outputDirectory, "local.ts"))) as {
    app: ScaffoldedApp;
  };
  return app;
};

const listFiles = async (root: string): Promise<string[]> =>
  (await fs.readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
    .sort();

const readJson = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await fs.readFile(filePath, "utf8")) as T;

describe("scaffold-mock lifecycle", () => {
  it("scaffolds a golden-shape workspace whose app serves a mock for every endpoint", async () => {
    const { exitCode, stdout, stderr, outputDirectory } = await scaffoldMock(
      { "models.ts": MEMBERS_MODELS, "contracts.ts": MEMBERS_CONTRACTS },
      ["--name", "members-mock"],
    );

    expect({ exitCode, stdout, stderr }).toEqual({
      exitCode: 0,
      stdout: `Scaffolded members-mock into ${outputDirectory}.\nNext: task install && task dev (see README.md).\n`,
      stderr: "",
    });
    // Golden workspace shape, suffix-free file names, and an artifact dir that
    // holds exactly openapi.json + schema.d.ts.
    await expect(`${(await listFiles(outputDirectory)).join("\n")}\n`).toMatchFileSnapshot(
      "__snapshots__/scaffold-mock-members.tree",
    );

    const read = (...segments: readonly string[]) =>
      fs.readFile(path.join(outputDirectory, ...segments), "utf8");
    // The generation pipeline runs through the rivet-ts passthrough, never a bare `rivet`.
    const taskfile = await read("Taskfile.yml");
    expect(taskfile).toContain(
      "rivet-ts --entry src/contracts.ts --out generated/api.contract.json",
    );
    expect(taskfile).toContain(
      "rivet-ts rivet -- --from generated/api.contract.json --output ../../packages/contracts/generated",
    );
    expect(taskfile).toContain("rivet-ts generate --generated-root");
    expect(taskfile).not.toMatch(/- rivet /u);
    // The UI demo call handles { data, error } (openapi-fetch never throws).
    const appVue = await read("apps", "ui", "app", "app.vue");
    expect(appVue).toContain('await client.GET("/api/members")');
    expect(appVue).toContain('v-if="error"');
    // The exact Zod schema is locked to the contract's body type.
    expect(
      await read("apps", "api", "src", "modules", "members", "members-validation.ts"),
    ).toContain(
      'satisfies z.ZodType<import("@maxanstey-meridian/rivet-ts").RivetHandlerInput<import("#contract").MembersContract, "Create">["body"]>',
    );

    const { version } = await readJson<{ version: string }>(
      path.join(PROJECT_ROOT, "package.json"),
    );
    const apiPackage = await readJson<{
      imports: Record<string, string>;
      exports: Record<string, string>;
      dependencies: Record<string, string>;
    }>(path.join(outputDirectory, "apps", "api", "package.json"));
    expect(apiPackage.imports["#contract"]).toBe("./src/contracts.ts");
    expect(apiPackage.exports).toMatchObject({
      "./local": "./src/local.ts",
      "./validation": "./src/validation.ts",
    });
    // The scaffolded rivet-ts pin tracks this package's version.
    expect(apiPackage.dependencies[PACKAGE_NAME]).toBe(`^${version}`);
    const contractsPackage = await readJson<{
      exports: Record<string, string>;
      dependencies: Record<string, string>;
    }>(path.join(outputDirectory, "packages", "contracts", "package.json"));
    expect(contractsPackage.exports["."]).toBe("./src/index.ts");
    expect(Object.keys(contractsPackage.dependencies)).toEqual(["openapi-fetch"]);

    // The app imports the contract JSON written with the document.
    const contractJson = parseContractJson(
      await read("apps", "api", "generated", "api.contract.json"),
    );
    expect(contractJson.endpoints.map((endpoint) => endpoint.name)).toEqual([
      "list",
      "create",
      "remove",
      "nested",
      "tree",
      "export",
    ]);

    const app = await loadScaffoldedApp(outputDirectory);
    const getJson = async (route: string) => {
      const response = await app.request(route);
      expect(response.status).toBe(200);
      return response.json();
    };
    await expect(getJson("/api/members")).resolves.toEqual({
      items: [{ id: "example", email: "example" }],
      totalCount: 0,
    });
    await expect(getJson("/api/members/nested")).resolves.toEqual({
      data: { value: { id: "example", email: "example" } },
    });
    // Recursion stops at boundaries with finite values: empty collections,
    // null for a nullable ref, and an omitted optional ref.
    await expect(getJson("/api/members/tree")).resolves.toEqual({
      name: "example",
      children: [],
      childrenByName: {},
      parent: null,
    });
    expect((await app.request("/api/members/mem_1", { method: "DELETE" })).status).toBe(204);
    // A file endpoint answers a content-typed placeholder, not its non-Blob example.
    const exported = await app.request("/api/members/export");
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toContain("text/csv");
    await expect(exported.text()).resolves.toBe("example");

    // The route edge parses the body: a rejected body is the 422 envelope, an
    // accepted one reaches the example-backed mock.
    const create = (body: object) =>
      app.request("/api/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const rejected = await create({ email: 42 });
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({
      code: "validation_failed",
      errors: { email: expect.any(Array) },
    });
    const created = await create({ email: "jane@example.com" });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: "mem_001", email: "jane@example.com" });

    const facade = (await import(
      path.join(outputDirectory, "packages", "contracts", "src", "index.ts")
    )) as { configureRivet: unknown };
    expect(facade.configureRivet).toBeTypeOf("function");
    const validation = (await import(apiSourcePath(outputDirectory, "validation.ts"))) as Record<
      string,
      unknown
    >;
    expect(Object.keys(validation)).toEqual(["createRequest"]);
  });

  it("has no plumb findings on a fresh mock beyond the recorded ones", async (context) => {
    const plumb = PLUMB_EXECUTABLE ?? context.skip(PLUMB_NOT_FOUND);
    const { exitCode, outputDirectory } = await scaffoldMock(
      { "models.ts": MEMBERS_MODELS, "contracts.ts": MEMBERS_CONTRACTS },
      ["--name", "members-mock"],
    );

    expect(exitCode).toBe(0);
    expect(await plumbFindings(plumb, outputDirectory)).toEqual([]);
  });

  it("scaffolds one module per contract when contracts share endpoint names", async () => {
    // A contract named like a rivet-ts type and two `Get`/`Create` pairs: per-module
    // routes files keep the handlers out of one import scope.
    const { exitCode, outputDirectory } = await scaffoldMock({
      "contracts.ts": `import type { Contract, Endpoint } from "@maxanstey-meridian/rivet-ts";

export interface PetDto {
  id: string;
  name: string;
}

export interface SummaryDto {
  total: number;
}

export interface RivetHandlerInput extends Contract<"Pet"> {
  Get: Endpoint<{ method: "GET"; route: "/api/pets/current"; response: PetDto }>;
  Create: Endpoint<{ method: "POST"; route: "/api/pets"; input: { name: string }; response: PetDto }>;
}

export interface SummaryContract extends Contract<"Summary"> {
  Get: Endpoint<{ method: "GET"; route: "/api/summary"; response: SummaryDto }>;
  Create: Endpoint<{ method: "POST"; route: "/api/summary"; input: { name: string }; response: SummaryDto }>;
}
`,
    });

    expect(exitCode).toBe(0);
    await expect(
      fs.access(apiSourcePath(outputDirectory, "modules", "pet", "pet-routes.ts")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(apiSourcePath(outputDirectory, "modules", "summary", "summary-routes.ts")),
    ).resolves.toBeUndefined();

    const app = await loadScaffoldedApp(outputDirectory);
    await expect((await app.request("/api/pets/current")).json()).resolves.toEqual({
      id: "example",
      name: "example",
    });
    await expect((await app.request("/api/summary")).json()).resolves.toEqual({ total: 0 });
    const validation = (await import(apiSourcePath(outputDirectory, "validation.ts"))) as Record<
      string,
      unknown
    >;
    expect(Object.keys(validation).sort()).toEqual(["petCreateRequest", "summaryCreateRequest"]);
  });

  it("serves endpoints whose names are numeric, quoted or collide with rivet-ts types", async () => {
    const quotedName = 'Say "hello" \\ now';
    const { exitCode, outputDirectory } = await scaffoldMock({
      "contracts.ts": `import type { Contract, Endpoint } from "@maxanstey-meridian/rivet-ts";

export interface NamesContract extends Contract<"Names"> {
  "123 Export": Endpoint<{ method: "GET"; route: "/api/numeric"; response: string }>;
  "Rivet Handler": Endpoint<{ method: "GET"; route: "/api/handler"; response: string }>;
  ${JSON.stringify(quotedName)}: Endpoint<{ method: "GET"; route: "/api/escaped"; response: string }>;
}
`,
    });

    expect(exitCode).toBe(0);
    const application = (file: string) =>
      apiSourcePath(outputDirectory, "modules", "names", "application", file);
    const app = await loadScaffoldedApp(outputDirectory);
    for (const route of ["/api/numeric", "/api/handler", "/api/escaped"]) {
      await expect((await app.request(route)).json()).resolves.toBe("example");
    }
    expect(Object.keys(await import(application("123-export.ts")))).toEqual(["_123Export"]);
    expect(Object.keys(await import(application("rivet-handler.ts")))).toEqual(["rivetHandler"]);
    await expect(fs.access(application("say-hello-now.ts"))).resolves.toBeUndefined();
  });

  it.each([
    {
      label: "generated identifier",
      endpoints: ["Export", "ExportEndpoint"],
      expected: 'same identifier "exportEndpoint"',
    },
    {
      label: "normalized filename",
      endpoints: ["GetURL", "get-url"],
      expected: 'same file "get-url.ts"',
    },
    {
      label: "route-module binding",
      endpoints: ["Create", "CreateRequest"],
      expected: 'same route-module binding "createRequest"',
    },
  ])("rejects $label collisions before writing files", async ({ endpoints, expected }) => {
    const members = endpoints.map((endpoint, index) =>
      endpoint === "Create"
        ? `  Create: Endpoint<{ method: "POST"; route: "/api/collision/${index}"; input: string; response: string }>;`
        : `  ${JSON.stringify(endpoint)}: Endpoint<{ method: "GET"; route: "/api/collision/${index}"; response: string }>;`,
    );
    const { exitCode, stderr, outputDirectory } = await scaffoldMock({
      "contracts.ts": `import type { Contract, Endpoint } from "@maxanstey-meridian/rivet-ts";

export interface CollisionContract extends Contract<"Collision"> {
${members.join("\n")}
}
`,
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain(expected);
    await expect(fs.stat(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects normalized contract artifact collisions before writing files", async () => {
    const { exitCode, stderr, outputDirectory } = await scaffoldMock({
      "contracts.ts": `import type { Contract, Endpoint } from "@maxanstey-meridian/rivet-ts";

export interface FooBarContract extends Contract<"FooBar"> {
  Create: Endpoint<{ method: "POST"; route: "/api/foo"; input: string; response: string }>;
}

export interface OtherContract extends Contract<"foo-bar"> {
  Update: Endpoint<{ method: "POST"; route: "/api/bar"; input: string; response: string }>;
}
`,
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      'Scaffold contract name collisions: contracts "FooBar" and "foo-bar" generate the same module directory "foo-bar"; contracts "FooBar" and "foo-bar" generate the same route registration identifier "registerFooBarRoutes"; contracts "FooBar" and "foo-bar" generate the same route file "foo-bar-routes.ts"; contracts "FooBar" and "foo-bar" generate the same validation file "foo-bar-validation.ts".',
    );
    await expect(fs.stat(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("derives safe module paths from arbitrary contract brands and serves them all", async () => {
    const { exitCode, outputDirectory } = await scaffoldMock({
      "contracts.ts": `import type { Contract, Endpoint } from "@maxanstey-meridian/rivet-ts";

export interface NumericBrandContract extends Contract<"123 Sales"> {
  List: Endpoint<{ method: "GET"; route: "/api/numeric"; response: string }>;
}

export interface PunctuationBrandContract extends Contract<"!!!"> {
  "---": Endpoint<{ method: "GET"; route: "/api/punctuation"; response: string }>;
}

export interface RivetHonoBrandContract extends Contract<"RivetHono"> {
  Get: Endpoint<{ method: "GET"; route: "/api/rivet-hono"; response: string }>;
}
`,
    });

    expect(exitCode).toBe(0);
    const modules = await fs.readdir(apiSourcePath(outputDirectory, "modules"));
    expect(modules.sort()).toEqual(["123-sales", "contract", "rivet-hono"]);
    const app = await loadScaffoldedApp(outputDirectory);
    for (const route of ["/api/numeric", "/api/punctuation", "/api/rivet-hono"]) {
      await expect((await app.request(route)).json()).resolves.toBe("example");
    }
  });

  it("serves a file endpoint as a typed placeholder and keeps it out of the UI demo", async () => {
    const { exitCode, outputDirectory } = await scaffoldMock({
      "contracts.ts": `import type { Contract, Endpoint } from "@maxanstey-meridian/rivet-ts";

export interface FilesContract extends Contract<"Files"> {
  Download: Endpoint<{
    method: "GET";
    route: "/api/files/download";
    fileResponse: true;
    fileContentType: "application/pdf";
  }>;
}
`,
    });

    expect(exitCode).toBe(0);
    const appVue = await fs.readFile(
      path.join(outputDirectory, "apps", "ui", "app", "app.vue"),
      "utf8",
    );
    expect(appVue).toContain("Typed client configured");
    expect(appVue).not.toContain("/api/files/download");

    const app = await loadScaffoldedApp(outputDirectory);
    const download = await app.request("/api/files/download");
    expect(download.headers.get("content-type")).toContain("application/pdf");
    await expect(download.text()).resolves.toBe("example");
  });

  it("passes every security scheme the contract uses to the Taskfile's Rivet step", async () => {
    const outputDirectory = path.join(await tempDir("rivet-ts-scaffold-mock-secure-"), "mock-app");
    const { exitCode } = await runCliCaptured([
      "scaffold-mock",
      "--entry",
      fixturePath("members-contract", "contracts.ts"),
      "--out",
      outputDirectory,
    ]);
    expect(exitCode).toBe(0);

    const taskfile = await fs.readFile(path.join(outputDirectory, "Taskfile.yml"), "utf8");
    const rivetStep = /rivet-ts rivet -- (?<arguments>.+)$/mu.exec(taskfile)?.groups?.["arguments"];
    expect(rivetStep).toContain("--security admin=bearer");

    // The step's own arguments, run by the pinned release as `task generate` runs them.
    const rivetArguments = String(rivetStep).split(" ");
    await expect(
      execFileAsync(await ensureRivetBinary(resolveRivetBinaryConfig()), rivetArguments, {
        cwd: path.join(outputDirectory, "apps", "api"),
      }),
    ).resolves.toBeDefined();
    await expect(
      fs.access(path.join(outputDirectory, "packages", "contracts", "generated", "openapi.json")),
    ).resolves.toBeUndefined();
  });

  it("copies the project's own modules but not a library its tsconfig maps to source outside it", async () => {
    // As templates/tsconfig.json does: the package resolves to its source, outside the project.
    const entryPath = await writeContractProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          paths: {
            [PACKAGE_NAME]: [path.join(PROJECT_ROOT, "src", "domain", "authoring-types.ts")],
            "@models/*": ["./models/*"],
          },
        },
      }),
      "models/member.ts": "export interface MemberDto { id: string; }\n",
      "contracts.ts": `import type { Contract, Endpoint } from "${PACKAGE_NAME}";
import type { MemberDto } from "@models/member";

export interface MembersContract extends Contract<"Members"> {
  List: Endpoint<{ method: "GET"; route: "/api/members"; response: MemberDto[] }>;
}
`,
    });

    expect(lowerContracts(entryPath).sourceFiles.map(({ relativePath }) => relativePath)).toEqual([
      "contracts.ts",
      "models/member.ts",
    ]);

    const outputDirectory = path.join(path.dirname(entryPath), "mock-app");
    const { exitCode, stderr } = await runCliCaptured([
      "scaffold-mock",
      "--entry",
      entryPath,
      "--out",
      outputDirectory,
    ]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    const apiSource = apiSourcePath(outputDirectory);
    const copied = (await listFiles(apiSource)).filter((file) => !file.startsWith("modules"));
    expect(copied).toEqual([
      "app.ts",
      "contracts.ts",
      "http-errors.ts",
      "local.ts",
      "main.ts",
      path.join("models", "member.ts"),
      "validation.ts",
    ]);
  });

  it("carries the project's tsconfig paths aliases to the copied contract sources", async () => {
    const projectDirectory = await tempDir("rivet-ts-scaffold-mock-paths-");
    const files: Readonly<Record<string, string>> = {
      "package.json": '{ "type": "module" }\n',
      // The library alias maps outside the project and is left to node_modules.
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          paths: {
            [PACKAGE_NAME]: [path.join(PROJECT_ROOT, "src", "domain", "authoring-types.ts")],
            "@models/*": ["./src/models/*"],
            "@shared": ["./src/shared/index.ts"],
          },
        },
      }),
      "src/models/member.ts": "export interface MemberDto { id: string; }\n",
      "src/shared/index.ts": "export interface PageDto<T> { items: T[]; }\n",
      "src/app/contracts.ts": `import type { Contract, Endpoint } from "${PACKAGE_NAME}";
import type { MemberDto } from "@models/member";
import type { PageDto } from "@shared";

export interface MembersContract extends Contract<"Members"> {
  List: Endpoint<{ method: "GET"; route: "/api/members"; response: PageDto<MemberDto> }>;
}
`,
    };
    for (const [relativePath, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(projectDirectory, relativePath)), { recursive: true });
      await fs.writeFile(path.join(projectDirectory, relativePath), content);
    }
    const outputDirectory = path.join(projectDirectory, "mock-app");

    const { exitCode, stderr } = await runCliCaptured([
      "scaffold-mock",
      "--entry",
      path.join(projectDirectory, "src", "app", "contracts.ts"),
      "--out",
      outputDirectory,
    ]);

    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    await typecheckScaffoldedWorkspace(outputDirectory);
  });

  it("scaffolds from a bare contract file without tsconfig or node_modules", async () => {
    const sourceDirectory = await tempDir("rivet-ts-scaffold-mock-bare-");
    const entryPath = path.join(sourceDirectory, "contracts.ts");
    const outputDirectory = path.join(sourceDirectory, "mock-app");
    await fs.writeFile(
      entryPath,
      `import type { Contract, Endpoint } from "@maxanstey-meridian/rivet-ts";

export interface HelloContract extends Contract<"Hello"> {
  Ping: Endpoint<{ method: "GET"; route: "/api/ping"; response: { message: "pong" } }>;
}
`,
    );

    const { exitCode, stderr } = await runCliCaptured([
      "scaffold-mock",
      "--entry",
      entryPath,
      "--out",
      outputDirectory,
    ]);

    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    await expect(fs.access(apiSourcePath(outputDirectory, "app.ts"))).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(outputDirectory, "packages", "contracts", "generated", "openapi.json")),
    ).resolves.toBeUndefined();
  });

  it("enforces spec constraints in the scaffolded validators when --spec is passed", async () => {
    const root = await tempDir("rivet-ts-scaffold-mock-spec-");
    // Shaped like the Rivet binary's real openapi.json: named components,
    // constraints as sibling keywords on the property schemas.
    const specPath = path.join(root, "openapi.json");
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
    const { exitCode, stderr, outputDirectory } = await scaffoldMock(
      {
        "contracts.ts": `import type { Contract, Endpoint } from "@maxanstey-meridian/rivet-ts";

export interface CreateWidgetRequest {
  name: string;
  quantity: number;
  tags: string[];
  nickname: string | null;
}

export interface WidgetDto {
  id: string;
}

export interface WidgetsContract extends Contract<"Widgets"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/widgets";
    input: CreateWidgetRequest;
    response: WidgetDto;
    successStatus: 201;
  }>;
}
`,
      },
      ["--spec", specPath],
    );

    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    // The enriched constraints reach the wire contract JSON, which stays
    // wire-legal (constraints are part of its schema).
    const contractJson = parseContractJson(
      await fs.readFile(
        path.join(outputDirectory, "apps", "api", "generated", "api.contract.json"),
        "utf8",
      ),
    );
    const requestType = contractJson.types.find((type) => type.name === "CreateWidgetRequest");
    expect(requestType?.properties?.find((property) => property.name === "name")).toMatchObject({
      constraints: { minLength: 3, maxLength: 20 },
    });

    // Constraint chains never change the output type, so the exactness lock
    // survives the enrichment (and the workspace still compiles below).
    const validationPath = apiSourcePath(
      outputDirectory,
      "modules",
      "widgets",
      "widgets-validation.ts",
    );
    expect(await fs.readFile(validationPath, "utf8")).toContain(
      'satisfies z.ZodType<import("@maxanstey-meridian/rivet-ts").RivetHandlerInput<import("#contract").WidgetsContract, "Create">["body"]>',
    );
    // A use case that reports the body keys it received shows it gets the
    // parsed body (unknown keys stripped), not the raw wire body.
    await fs.writeFile(
      apiSourcePath(outputDirectory, "modules", "widgets", "application", "create.ts"),
      `export const create = async (input: import("@maxanstey-meridian/rivet-ts").RivetHandlerInput<import("#contract").WidgetsContract, "Create">): Promise<import("@maxanstey-meridian/rivet-ts").RivetHandlerResult<import("#contract").WidgetsContract, "Create">> => ({
  id: Object.keys(input.body).sort().join(","),
});
`,
    );
    const app = await loadScaffoldedApp(outputDirectory);
    const valid = { name: "Widget", quantity: 10, tags: ["a"], nickname: null };
    const created = await app.request("/api/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...valid, extra: "raw" }),
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toEqual({ id: "name,nickname,quantity,tags" });

    const { createRequest } = (await import(validationPath)) as {
      createRequest: { safeParse: (value: unknown) => { success: boolean } };
    };
    expect(createRequest.safeParse(valid).success).toBe(true);
    for (const invalid of [
      { name: "ab" },
      { name: "w".repeat(21) },
      { quantity: 0 },
      { quantity: 101 },
      { tags: [] },
      { tags: ["a", "b", "c", "d"] },
      { tags: ["a", "a"] },
      { nickname: "x" },
    ]) {
      expect(
        createRequest.safeParse({ ...valid, ...invalid }).success,
        JSON.stringify(invalid),
      ).toBe(false);
    }
  });

  it("refuses to overwrite a non-empty output directory unless --force is passed", async () => {
    const { exitCode, entryPath, outputDirectory } = await scaffoldMock({
      "models.ts": MEMBERS_MODELS,
      "contracts.ts": MEMBERS_CONTRACTS,
    });
    expect(exitCode).toBe(0);
    const appPath = apiSourcePath(outputDirectory, "app.ts");
    const scaffolded = await fs.readFile(appPath, "utf8");
    const userEdit = "// user edit that must survive a forceless re-run\n";
    await fs.writeFile(appPath, userEdit);
    const rerun = (...extraArgs: readonly string[]) =>
      runCliCaptured([
        "scaffold-mock",
        "--entry",
        entryPath,
        "--out",
        outputDirectory,
        ...extraArgs,
      ]);

    const refused = await rerun();

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("--force");
    await expect(fs.readFile(appPath, "utf8")).resolves.toBe(userEdit);

    expect((await rerun("--force")).exitCode).toBe(0);
    await expect(fs.readFile(appPath, "utf8")).resolves.toBe(scaffolded);
  });

  it("refuses a contract endpoint the lowered document does not carry, instead of dropping its handler", async () => {
    const entryPath = await writeContractProject({
      "contracts.ts": `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface ThingsContract extends Contract<"Things"> {
  ListThings: Endpoint<{ method: "GET"; route: "/api/things"; response: string[] }>;
  CountThings: Endpoint<{ method: "GET"; route: "/api/things/count"; response: number }>;
}
`,
    });
    const lowered = lowerContracts(entryPath);
    expect(lowered.hasErrors).toBe(false);

    await expect(
      emitMockProject({
        outDir: path.join(path.dirname(entryPath), "mock-app"),
        projectName: "things",
        entryPath,
        force: false,
        contracts: lowered.contracts,
        sourceFiles: lowered.sourceFiles,
        sourcePathAliases: lowered.sourcePathAliases,
        document: new RivetContractDocument({
          ...lowered.document,
          endpoints: lowered.document.endpoints.filter(
            (endpoint) => endpoint.name !== "countThings",
          ),
        }),
      }),
    ).rejects.toThrow(
      'Endpoint "Things.CountThings" is missing from the lowered contract document.',
    );
  });
});
