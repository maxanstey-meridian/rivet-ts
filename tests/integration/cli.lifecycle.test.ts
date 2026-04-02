import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../../src/interfaces/cli/run-cli.js";

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

const readJsonFixture = async (relativePath: string): Promise<unknown> => {
  const fileContents = await fs.readFile(getFixturePath(relativePath), "utf8");
  return JSON.parse(fileContents) as unknown;
};

describe("CLI lifecycle", () => {
  it("writes Rivet contract JSON to an output file", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-"));
    const outputPath = path.join(tempDirectory, "contract.json");
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(
      [
        "--entry",
        getFixturePath(path.join("members-contract", "contracts.ts")),
        "--out",
        outputPath,
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = JSON.parse(fileContents) as {
      endpoints: Array<{ name: string; routeTemplate: string }>;
    };

    expect(payload).toEqual(
      await readJsonFixture(path.join("members-contract", "golden-contract.json")),
    );
    expect(payload.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "invite", routeTemplate: "/api/members" }),
        expect.objectContaining({ name: "updateRole", routeTemplate: "/api/members/{id}/role" }),
      ]),
    );
  });

  it("writes Rivet contract JSON for aliased endpoint specs through the real CLI path", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-"));
    const outputPath = path.join(tempDirectory, "aliased-contract.json");
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(
      [
        "--entry",
        getFixturePath(path.join("aliased-authoring-contract", "contracts.ts")),
        "--out",
        outputPath,
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = JSON.parse(fileContents) as {
      endpoints: Array<{
        name: string;
        routeTemplate: string;
        security?: { scheme?: string; isAnonymous: boolean };
        responses: Array<{ statusCode: number; description?: string }>;
      }>;
    };

    expect(payload.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "list",
          routeTemplate: "/api/aliased-members",
          security: {
            isAnonymous: false,
            scheme: "admin",
          },
          responses: expect.arrayContaining([
            expect.objectContaining({
              statusCode: 404,
              description: "Members not found",
            }),
          ]),
        }),
      ]),
    );
  });

  it("reports invalid security helper usage through the real CLI path", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-invalid-security-"));
    const entryPath = path.join(tempDirectory, "contracts.ts");
    const outputPath = path.join(tempDirectory, "contract.json");
    const normalizedImportPath = toImportPath(
      tempDirectory,
      path.join(getProjectRoot(), "dist", "index.js"),
    );
    const stdout: string[] = [];
    const stderr: string[] = [];

    await fs.writeFile(
      entryPath,
      [
        `import type { Contract, Endpoint, EndpointSecurityAuthoringSpec } from "${normalizedImportPath}";`,
        "",
        'export interface TempContract extends Contract<"TempContract"> {',
        "  Create: Endpoint<{",
        '    method: "POST";',
        '    route: "/api/temp";',
        "    response: void;",
        "    security: EndpointSecurityAuthoringSpec;",
        "  }>;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const exitCode = await runCli(["--entry", entryPath, "--out", outputPath], {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(0);
    expect(stderr).toEqual(
      expect.arrayContaining([expect.stringContaining("[INVALID_SECURITY_SPEC]")]),
    );
    expect(stderr.join("")).toContain("security.scheme as a string literal");
  });
});
