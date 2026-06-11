import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { runCli } from "../../src/interfaces/cli/run-cli.js";

const getProjectRoot = (): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "..");
};

describe("vite plugin lifecycle", () => {
  it("generates contract artifacts and local transport for a scaffolded api package", async () => {
    const projectRoot = getProjectRoot();
    // realpath: macOS tmpdir lives behind the /var -> /private/var symlink,
    // which breaks Vite's root-relative asset names when paths mix.
    const tempDirectory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-vite-plugin-")),
    );
    const sampleRoot = path.join(tempDirectory, "myapp");
    const nodeModulesDirectory = path.join(sampleRoot, "node_modules");
    const sourceDirectory = path.join(tempDirectory, "source");
    const sourceNodeModulesDirectory = path.join(sourceDirectory, "node_modules");

    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.mkdir(nodeModulesDirectory, { recursive: true });
    await fs.mkdir(sourceNodeModulesDirectory, { recursive: true });
    await fs.symlink(projectRoot, path.join(nodeModulesDirectory, "rivet-ts"), "dir");
    await fs.symlink(projectRoot, path.join(sourceNodeModulesDirectory, "rivet-ts"), "dir");
    await fs.symlink(
      path.join(projectRoot, "node_modules", "vite"),
      path.join(nodeModulesDirectory, "vite"),
      "dir",
    );
    await fs.mkdir(path.join(nodeModulesDirectory, "@myapp"), { recursive: true });
    await fs.symlink(
      path.join(projectRoot, "node_modules", "hono"),
      path.join(nodeModulesDirectory, "hono"),
      "dir",
    );
    // The generated client package imports openapi-fetch at runtime; the
    // sample workspace resolves it from this repo's store (offline).
    await fs.symlink(
      path.join(projectRoot, "node_modules", "openapi-fetch"),
      path.join(nodeModulesDirectory, "openapi-fetch"),
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

    // The fake binary mirrors the real tool's contract for WP-5a: `--from
    // <contract.json> --output <dir> --openapi <path>` writes the OpenAPI spec
    // the plugin then feeds to openapi-typescript.
    const fakeRivetBinaryPath = path.join(sampleRoot, "fake-rivet.mjs");
    await fs.writeFile(
      fakeRivetBinaryPath,
      [
        "#!/usr/bin/env node",
        'import fs from "node:fs/promises";',
        'import path from "node:path";',
        "",
        "const args = process.argv.slice(2);",
        'const openApiIndex = args.indexOf("--openapi");',
        "if (openApiIndex === -1 || openApiIndex + 1 >= args.length) {",
        '  throw new Error("Missing --openapi");',
        "}",
        'const fromIndex = args.indexOf("--from");',
        "if (fromIndex === -1 || fromIndex + 1 >= args.length) {",
        '  throw new Error("Missing --from");',
        "}",
        "// The contract JSON must already exist when the binary runs.",
        "await fs.access(args[fromIndex + 1]);",
        "const openApiPath = args[openApiIndex + 1];",
        "await fs.mkdir(path.dirname(openApiPath), { recursive: true });",
        "const spec = {",
        '  openapi: "3.1.0",',
        '  info: { title: "myapp", version: "1.0.0" },',
        "  paths: {",
        '    "/api/members": {',
        "      get: {",
        "        responses: {",
        '          "200": {',
        '            description: "ok",',
        "            content: {",
        '              "application/json": {',
        "                schema: {",
        '                  type: "array",',
        "                  items: {",
        '                    type: "object",',
        '                    properties: { id: { type: "string" }, email: { type: "string" } },',
        '                    required: ["id", "email"],',
        "                  },",
        "                },",
        "              },",
        "            },",
        "          },",
        "        },",
        "      },",
        "      post: {",
        "        requestBody: {",
        "          required: true,",
        "          content: {",
        '            "application/json": {',
        "              schema: {",
        '                type: "object",',
        '                properties: { email: { type: "string" } },',
        '                required: ["email"],',
        "              },",
        "            },",
        "          },",
        "        },",
        "        responses: {",
        '          "201": {',
        '            description: "created",',
        "            content: {",
        '              "application/json": {',
        "                schema: {",
        '                  type: "object",',
        '                  properties: { id: { type: "string" }, email: { type: "string" } },',
        '                  required: ["id", "email"],',
        "                },",
        "              },",
        "            },",
        "          },",
        "        },",
        "      },",
        "    },",
        "  },",
        "};",
        "await fs.writeFile(openApiPath, `${JSON.stringify(spec, null, 2)}\\n`);",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.chmod(fakeRivetBinaryPath, 0o755);

    // V1 pin: the build runs from THIS process's cwd (the repo, not the
    // sample). The plugin must resolve the relative paths below against the
    // directory the Vite config file lives in, never process.cwd().
    await fs.writeFile(
      path.join(sampleRoot, "vite.config.ts"),
      [
        'import { defineConfig } from "vite";',
        'import { rivetTs } from "rivet-ts/vite";',
        "",
        "export default defineConfig({",
        // Vite resolves its own `root` against process.cwd(); use an absolute
        // path for it. The rivetTs() options stay relative on purpose — they
        // must resolve against the config file directory (V1).
        `  root: ${JSON.stringify(path.join(sampleRoot, "ui"))},`,
        '  logLevel: "silent",',
        "  plugins: [",
        "    rivetTs({",
        '      entry: "./packages/api/src/app/contracts.ts",',
        '      apiRoot: "./packages/api",',
        '      runtimeContractOut: "./packages/api/generated/api.contract.json",',
        '      clientOutDir: "./packages/client/generated",',
        "      rivet: {",
        `        binaryPath: ${JSON.stringify(fakeRivetBinaryPath)},`,
        "      },",
        "    }),",
        "  ],",
        "  build: {",
        '    outDir: "../dist",',
        "    emptyOutDir: true,",
        "  },",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );

    expect(process.cwd()).not.toBe(sampleRoot);
    await build({
      configFile: path.join(sampleRoot, "vite.config.ts"),
      logLevel: "silent",
    });

    await expect(
      fs.stat(path.join(apiRoot, "generated", "api.contract.json")),
    ).resolves.toBeTruthy();
    await expect(fs.stat(path.join(clientRoot, "generated", "openapi.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(clientRoot, "generated", "schema.d.ts"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(clientRoot, "generated", "index.ts"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(sampleRoot, "dist", "index.html"))).resolves.toBeTruthy();

    const uiMainSource = await fs.readFile(path.join(sampleRoot, "ui", "src", "main.ts"), "utf8");
    const uiLocalRivetSource = await fs.readFile(
      path.join(sampleRoot, "ui", "rivet-local.ts"),
      "utf8",
    );
    const schemaSource = await fs.readFile(
      path.join(clientRoot, "generated", "schema.d.ts"),
      "utf8",
    );
    const clientEntrySource = await fs.readFile(
      path.join(clientRoot, "generated", "index.ts"),
      "utf8",
    );
    expect(uiMainSource).toContain('import { client } from "@myapp/client";');
    expect(uiMainSource).toContain('client.GET("/api/members")');
    expect(uiLocalRivetSource).toContain('import { app } from "@myapp/api/local";');
    expect(uiLocalRivetSource).toContain("app.request");
    expect(schemaSource).toContain("export interface paths");
    expect(schemaSource).toContain('"/api/members"');
    expect(schemaSource).toContain("email: string;");
    expect(clientEntrySource).toContain(
      'import createOpenApiClient, { type Client, type ClientOptions } from "openapi-fetch";',
    );
    expect(clientEntrySource).toContain('import type { paths } from "./schema.js";');
    expect(clientEntrySource).toContain("export const configureRivet = (config: RivetConfig)");
    expect(clientEntrySource).not.toContain("rivetFetch");
    expect(clientEntrySource).not.toContain("RivetError");
  }, 20_000);

  // V3: the plugin used to concatenate frontend diagnostics with the lowerer
  // result (which already includes them), reporting everything twice.
  it("reports each contract diagnostic exactly once when generation fails", async () => {
    const tempDirectory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-vite-plugin-broken-")),
    );
    const uiRoot = path.join(tempDirectory, "ui");
    await fs.mkdir(uiRoot, { recursive: true });
    await fs.writeFile(
      path.join(uiRoot, "index.html"),
      '<!DOCTYPE html><html><body><script type="module"></script></body></html>\n',
    );

    const logged: string[] = [];
    const logger = {
      info: (message: string) => logged.push(message),
      warn: (message: string) => logged.push(message),
      warnOnce: (message: string) => logged.push(message),
      error: (message: string) => logged.push(message),
      clearScreen: () => undefined,
      hasErrorLogged: () => false,
      hasWarned: false,
    };

    const { rivetTs } = await import("../../src/vite.js");

    await expect(
      build({
        configFile: false,
        root: uiRoot,
        logLevel: "silent",
        customLogger: logger,
        plugins: [
          rivetTs({
            entry: path.join(tempDirectory, "does-not-exist.ts"),
            apiRoot: tempDirectory,
          }),
        ],
      }),
    ).rejects.toThrow("rivet-ts/vite failed to reflect the contract.");

    const combinedLog = logged.join("\n");
    const occurrences = combinedLog.match(/\[ENTRY_NOT_FOUND\]/g) ?? [];
    expect(occurrences).toHaveLength(1);
  }, 20_000);
});
