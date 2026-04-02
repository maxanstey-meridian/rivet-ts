import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCli } from "../../src/interfaces/cli/run-cli.js";

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

describe("CLI lifecycle", () => {
  it("writes extracted contract JSON to an output file", async () => {
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
      contracts: Array<{ name: string; endpoints: Array<{ name: string; route: string }> }>;
    };

    expect(payload.contracts).toHaveLength(1);
    expect(payload.contracts[0]?.name).toBe("MembersContract");
    expect(payload.contracts[0]?.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Invite", route: "/api/members" }),
        expect.objectContaining({ name: "UpdateRole", route: "/api/members/{id}/role" }),
      ]),
    );
  });
});
