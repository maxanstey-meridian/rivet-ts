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
    const apiRoot = path.join(sampleRoot, "packages", "api");
    const uiRoot = path.join(sampleRoot, "ui");
    const nodeModulesDirectory = path.join(sampleRoot, "node_modules");

    await fs.mkdir(path.join(apiRoot), { recursive: true });
    await fs.mkdir(path.join(uiRoot, "src"), { recursive: true });
    await fs.mkdir(nodeModulesDirectory, { recursive: true });
    await fs.symlink(projectRoot, path.join(nodeModulesDirectory, "rivet-ts"), "dir");
    await fs.symlink(
      path.join(projectRoot, "node_modules", "hono"),
      path.join(nodeModulesDirectory, "hono"),
      "dir",
    );

    await fs.writeFile(
      path.join(apiRoot, "contracts.ts"),
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
      path.join(apiRoot, "contracts.ts"),
      "--out",
      apiRoot,
    ]);

    expect(scaffoldExitCode).toBe(0);

    await fs.writeFile(
      path.join(uiRoot, "index.html"),
      [
        "<!doctype html>",
        '<html lang="en">',
        "  <body>",
        '    <div id="app"></div>',
        '    <script type="module" src="/src/main.ts"></script>',
        "  </body>",
        "</html>",
        "",
      ].join("\n"),
    );

    await fs.writeFile(
      path.join(uiRoot, "src", "main.ts"),
      [
        'import { members } from "@api/generated/rivet/client/index.js";',
        'import { configureLocalRivet } from "@api/src/local-rivet.js";',
        "",
        "const run = async (): Promise<void> => {",
        "  configureLocalRivet();",
        '  const output = document.getElementById("app");',
        "  if (!output) {",
        "    return;",
        "  }",
        "  const list = await members.list();",
        '  output.textContent = JSON.stringify(list);',
        "};",
        "",
        "void run();",
        "",
      ].join("\n"),
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
        'await fs.mkdir(clientDir, { recursive: true });',
        'await fs.mkdir(typesDir, { recursive: true });',
        'await fs.writeFile(path.join(typesDir, "common.ts"), `export type MemberDto = { id: string; email: string };\\nexport type CreateMemberRequest = { email: string };\\n`);',
        'await fs.writeFile(path.join(typesDir, "index.ts"), `export * from "./common.js";\\n`);',
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
            contract: "./packages/api/contracts.ts",
            apiRoot: "./packages/api",
            app: "./packages/api/src/api.ts",
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

    await expect(fs.stat(path.join(apiRoot, "generated", "api.contract.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(apiRoot, "generated", "rivet", "client", "index.ts"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(sampleRoot, "dist", "index.html"))).resolves.toBeTruthy();

    const localRivetSource = await fs.readFile(path.join(apiRoot, "src", "local-rivet.ts"), "utf8");
    expect(localRivetSource).toContain("app.request");
  });
});
