import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { runCli } from "../../src/interfaces/cli/run-cli.js";
import { rivetTs } from "../../src/vite.js";

const getProjectRoot = (): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "..");
};

describe("vite plugin lifecycle", () => {
  it("generates contract artifacts and local transport for a scaffolded api package", async () => {
    const projectRoot = getProjectRoot();
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-vite-plugin-"));
    const sampleRoot = path.join(tempDirectory, "myapp");
    const nodeModulesDirectory = path.join(sampleRoot, "node_modules");
    const sourceDirectory = path.join(tempDirectory, "source");
    const sourceNodeModulesDirectory = path.join(sourceDirectory, "node_modules");

    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.mkdir(nodeModulesDirectory, { recursive: true });
    await fs.mkdir(sourceNodeModulesDirectory, { recursive: true });
    await fs.symlink(projectRoot, path.join(nodeModulesDirectory, "rivet-ts"), "dir");
    await fs.symlink(projectRoot, path.join(sourceNodeModulesDirectory, "rivet-ts"), "dir");
    await fs.mkdir(path.join(nodeModulesDirectory, "@myapp"), { recursive: true });
    await fs.symlink(
      path.join(projectRoot, "node_modules", "hono"),
      path.join(nodeModulesDirectory, "hono"),
      "dir",
    );
    await fs.writeFile(path.join(sourceDirectory, "package.json"), '{ "type": "module" }\n');

    await fs.writeFile(
      path.join(sourceDirectory, "contracts.ts"),
      [
        'import type { Contract, Endpoint } from "rivet-ts";',
        "",
        "export interface MemberDto {",
        "  id: string;",
        "  email: string;",
        "}",
        "",
        "export interface CreateMemberRequest {",
        "  email: string;",
        "}",
        "",
        'export interface MembersContract extends Contract<"MembersContract"> {',
        "  List: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/members";',
        "    response: MemberDto[];",
        "  }>;",
        "",
        "  Create: Endpoint<{",
        '    method: "POST";',
        '    route: "/api/members";',
        "    input: CreateMemberRequest;",
        "    response: MemberDto;",
        "    successStatus: 201;",
        "  }>;",
        "}",
        "",
      ].join("\n"),
    );

    const scaffoldExitCode = await runCli([
      "scaffold-mock",
      "--entry",
      path.join(sourceDirectory, "contracts.ts"),
      "--out",
      sampleRoot,
    ]);

    expect(scaffoldExitCode).toBe(0);
    const apiRoot = path.join(sampleRoot, "packages", "api");
    const clientRoot = path.join(sampleRoot, "packages", "client");

    await fs.symlink(
      path.join(sampleRoot, "packages", "api"),
      path.join(nodeModulesDirectory, "@myapp", "api"),
      "dir",
    );
    await fs.symlink(
      path.join(sampleRoot, "packages", "client"),
      path.join(nodeModulesDirectory, "@myapp", "client"),
      "dir",
    );

    const fakeRivetBinaryPath = path.join(sampleRoot, "fake-rivet.mjs");
    await fs.writeFile(
      fakeRivetBinaryPath,
      [
        "#!/usr/bin/env node",
        'import fs from "node:fs/promises";',
        'import path from "node:path";',
        "",
        "const args = process.argv.slice(2);",
        'const outputIndex = args.indexOf("--output");',
        "if (outputIndex === -1 || outputIndex + 1 >= args.length) {",
        '  throw new Error("Missing --output");',
        "}",
        "const outDir = args[outputIndex + 1];",
        'const clientDir = path.join(outDir, "client");',
        'const typesDir = path.join(outDir, "types");',
        "await fs.mkdir(clientDir, { recursive: true });",
        "await fs.mkdir(typesDir, { recursive: true });",
        'await fs.writeFile(path.join(typesDir, "common.ts"), `export type MemberDto = { id: string; email: string };\\nexport type CreateMemberRequest = { email: string };\\n`);',
        'await fs.writeFile(path.join(typesDir, "index.ts"), `export * from "./common.js";\\n`);',
        'await fs.writeFile(path.join(outDir, "schemas.ts"), `export const createMemberRequestSchema = { type: "object" };\\n`);',
        'await fs.writeFile(path.join(outDir, "validators.ts"), `export const validateCreateMemberRequest = () => true;\\n`);',
        'await fs.writeFile(path.join(outDir, "rivet.ts"), [',
        '  "let currentConfig = { baseUrl: \\"\\", fetch: globalThis.fetch };",',
        '  "export const configureRivet = (config) => { currentConfig = { ...currentConfig, ...config }; };",',
        '  "export const rivetFetch = async (method, route, init = {}) => {",',
        '  "  const response = await currentConfig.fetch(`${currentConfig.baseUrl}${route}`, {",',
        '  "    method,",',
        '  "    body: init.body ? JSON.stringify(init.body) : undefined,",',
        '  "    headers: init.body ? { \\"content-type\\": \\"application/json\\" } : undefined,",',
        '  "  });",',
        '  "  return response.json();",',
        '  "};",',
        '  "",',
        '].join("\\n"));',
        'await fs.writeFile(path.join(clientDir, "members.ts"), `import { rivetFetch } from "../rivet.js";\\nexport const list = () => rivetFetch("GET", "/api/members");\\nexport const create = (body) => rivetFetch("POST", "/api/members", { body });\\n`);',
        'await fs.writeFile(path.join(clientDir, "index.ts"), `export * as members from "./members.js";\\n`);',
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.chmod(fakeRivetBinaryPath, 0o755);

    const previousWorkingDirectory = process.cwd();
    process.chdir(sampleRoot);

    try {
      await build({
        configFile: false,
        root: "ui",
        logLevel: "silent",
        plugins: [
          rivetTs({
            entry: "./packages/api/src/app/contracts.ts",
            apiRoot: "./packages/api",
            runtimeContractOut: "./packages/api/generated/api.contract.json",
            clientOutDir: "./packages/client/generated",
            rivet: {
              binaryPath: fakeRivetBinaryPath,
            },
          }),
        ],
        build: {
          outDir: "../dist",
          emptyOutDir: true,
        },
      });
    } finally {
      process.chdir(previousWorkingDirectory);
    }

    await expect(
      fs.stat(path.join(apiRoot, "generated", "api.contract.json")),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(clientRoot, "generated", "rivet", "client", "index.ts")),
    ).resolves.toBeTruthy();
    await expect(fs.stat(path.join(clientRoot, "generated", "index.ts"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(sampleRoot, "dist", "index.html"))).resolves.toBeTruthy();

    const uiMainSource = await fs.readFile(path.join(sampleRoot, "ui", "src", "main.ts"), "utf8");
    const uiLocalRivetSource = await fs.readFile(
      path.join(sampleRoot, "ui", "rivet-local.ts"),
      "utf8",
    );
    const clientEntrySource = await fs.readFile(
      path.join(clientRoot, "generated", "index.ts"),
      "utf8",
    );
    expect(uiMainSource).toContain('import { members } from "@myapp/client";');
    expect(uiMainSource).toContain("members.list()");
    expect(uiLocalRivetSource).toContain('import { app } from "@myapp/api/local";');
    expect(uiLocalRivetSource).toContain("app.request");
    expect(clientEntrySource).toContain("export { RivetError, configureRivet, rivetFetch }");
    expect(clientEntrySource).toContain('export * as schemas from "./rivet/schemas.js";');
    expect(clientEntrySource).toContain('export * as validators from "./rivet/validators.js";');
  }, 20_000);
});
