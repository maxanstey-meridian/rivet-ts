import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/interfaces/cli/run-cli.js";

describe("generate CLI", () => {
  it("emits the generated client facade with optional schemas and validators", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-generate-"));
    const generatedRoot = path.join(tempDirectory, "generated");

    await fs.mkdir(path.join(generatedRoot, "rivet", "client"), { recursive: true });
    await fs.mkdir(path.join(generatedRoot, "rivet", "types"), { recursive: true });
    await fs.writeFile(
      path.join(generatedRoot, "rivet", "client", "members.ts"),
      "export const list = () => null;\n",
    );
    await fs.writeFile(
      path.join(generatedRoot, "rivet", "rivet.ts"),
      "export const configureRivet = () => undefined;\n",
    );
    await fs.writeFile(
      path.join(generatedRoot, "rivet", "types", "common.ts"),
      "export type MemberDto = { id: string };\n",
    );
    await fs.writeFile(
      path.join(generatedRoot, "rivet", "schemas.ts"),
      "export const memberSchema = {};\n",
    );
    await fs.writeFile(
      path.join(generatedRoot, "rivet", "validators.ts"),
      "export const validateMember = () => true;\n",
    );

    await expect(runCli(["generate", "--generated-root", generatedRoot])).resolves.toBe(0);

    const clientEntrySource = await fs.readFile(path.join(generatedRoot, "index.ts"), "utf8");

    expect(clientEntrySource).toContain('import * as members from "./rivet/client/members.js";');
    expect(clientEntrySource).toContain("export { members };");
    expect(clientEntrySource).toContain('export * as schemas from "./rivet/schemas.js";');
    expect(clientEntrySource).toContain('export * as validators from "./rivet/validators.js";');
    expect(clientEntrySource).toContain('export type * from "./rivet/types/common.js";');
  });

  it("emits runtime exports even when no generated client modules exist", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-generate-empty-"));
    const generatedRoot = path.join(tempDirectory, "generated");

    await fs.mkdir(path.join(generatedRoot, "rivet"), { recursive: true });
    await fs.writeFile(
      path.join(generatedRoot, "rivet", "rivet.ts"),
      "export const configureRivet = () => undefined;\n",
    );

    await expect(runCli(["generate", "--generated-root", generatedRoot])).resolves.toBe(0);

    const clientEntrySource = await fs.readFile(path.join(generatedRoot, "index.ts"), "utf8");

    expect(clientEntrySource).toContain(
      'export { RivetError, configureRivet, rivetFetch } from "./rivet/rivet.js";',
    );
    expect(clientEntrySource).not.toContain("export {  };");
    expect(clientEntrySource).not.toContain('export * as schemas from "./rivet/schemas.js";');
    expect(clientEntrySource).not.toContain('export * as validators from "./rivet/validators.js";');
  });

  it("returns usage error when --generated-root is omitted", async () => {
    const stderr: string[] = [];

    await expect(
      runCli(["generate"], {
        stdout: () => undefined,
        stderr: (text) => stderr.push(text),
      }),
    ).resolves.toBe(1);

    expect(stderr.join("")).toContain("Usage: rivet-ts generate --generated-root <dir>");
  });
});
