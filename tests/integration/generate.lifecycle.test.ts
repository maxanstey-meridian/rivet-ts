import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/interfaces/cli/run-cli.js";

const SPEC = {
  openapi: "3.1.0",
  info: { title: "members", version: "1.0.0" },
  paths: {
    "/api/members": {
      get: {
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { id: { type: "string" }, email: { type: "string" } },
                    required: ["id", "email"],
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

describe("generate CLI", () => {
  it("emits schema.d.ts and the openapi-fetch client facade from openapi.json", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-generate-"));
    const generatedRoot = path.join(tempDirectory, "generated");

    await fs.mkdir(generatedRoot, { recursive: true });
    await fs.writeFile(
      path.join(generatedRoot, "openapi.json"),
      `${JSON.stringify(SPEC, null, 2)}\n`,
    );

    await expect(runCli(["generate", "--generated-root", generatedRoot])).resolves.toBe(0);

    const schemaSource = await fs.readFile(path.join(generatedRoot, "schema.d.ts"), "utf8");
    expect(schemaSource).toContain("export interface paths");
    expect(schemaSource).toContain('"/api/members"');
    expect(schemaSource).toContain("email: string;");

    const clientEntrySource = await fs.readFile(path.join(generatedRoot, "index.ts"), "utf8");
    expect(clientEntrySource).toContain(
      'import createOpenApiClient, { type Client, type ClientOptions } from "openapi-fetch";',
    );
    expect(clientEntrySource).toContain('import type { paths } from "./schema.js";');
    expect(clientEntrySource).toContain("export const createClient = (config: RivetConfig)");
    expect(clientEntrySource).toContain("export let client: RivetClient");
    expect(clientEntrySource).toContain("export const configureRivet = (config: RivetConfig)");
  });

  it("is idempotent: re-running over unchanged inputs rewrites nothing", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-generate-idem-"));
    const generatedRoot = path.join(tempDirectory, "generated");

    await fs.mkdir(generatedRoot, { recursive: true });
    await fs.writeFile(
      path.join(generatedRoot, "openapi.json"),
      `${JSON.stringify(SPEC, null, 2)}\n`,
    );

    await expect(runCli(["generate", "--generated-root", generatedRoot])).resolves.toBe(0);
    const firstSchemaStat = await fs.stat(path.join(generatedRoot, "schema.d.ts"));
    const firstIndexStat = await fs.stat(path.join(generatedRoot, "index.ts"));

    await expect(runCli(["generate", "--generated-root", generatedRoot])).resolves.toBe(0);
    const secondSchemaStat = await fs.stat(path.join(generatedRoot, "schema.d.ts"));
    const secondIndexStat = await fs.stat(path.join(generatedRoot, "index.ts"));

    expect(secondSchemaStat.mtimeMs).toBe(firstSchemaStat.mtimeMs);
    expect(secondIndexStat.mtimeMs).toBe(firstIndexStat.mtimeMs);
  });

  it("fails loudly when openapi.json is missing", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-generate-missing-"));
    const generatedRoot = path.join(tempDirectory, "generated");
    await fs.mkdir(generatedRoot, { recursive: true });

    const stderr: string[] = [];

    await expect(
      runCli(["generate", "--generated-root", generatedRoot], {
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
      }),
    ).resolves.toBe(1);

    expect(stderr.join("")).toContain("OpenAPI spec not found");
    expect(stderr.join("")).toContain("--output");
  });

  it("returns usage error when --generated-root is omitted", async () => {
    const stderr: string[] = [];

    await expect(
      runCli(["generate"], {
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
      }),
    ).resolves.toBe(1);

    expect(stderr.join("")).toContain("rivet-ts generate --generated-root <dir>");
  });
});
