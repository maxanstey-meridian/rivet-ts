import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runCli } from "../../src/interfaces/cli/run-cli.js";

const execFileAsync = promisify(execFile);

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

const getProjectRoot = (): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "..");
};

const captureIO = (): {
  stdout: string[];
  stderr: string[];
  io: { stdout: (text: string) => void; stderr: (text: string) => void };
} => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    },
  };
};

describe("CLI build-local", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-ts-cli-build-local-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("produces output directory with expected structure", async () => {
    const outDir = path.join(tmpDir, "pkg");
    const { io } = captureIO();

    const exitCode = await runCli(
      [
        "build-local",
        "--entry",
        getFixturePath("handler-entrypoint/index.ts"),
        "--target",
        "browser",
        "--package-name",
        "@test/my-pkg",
        "--out",
        outDir,
      ],
      io,
    );

    expect(exitCode).toBe(0);

    const entries = await fs.readdir(outDir);
    expect(entries.sort()).toEqual(
      ["client", "contract", "index.d.ts", "index.js", "package.json", "runtime"].sort(),
    );

    const clientEntries = await fs.readdir(path.join(outDir, "client"));
    expect(clientEntries.sort()).toEqual(
      expect.arrayContaining(["pet.js", "pet.d.ts", "summary.js", "summary.d.ts"]),
    );

    const contractEntries = await fs.readdir(path.join(outDir, "contract"));
    expect(contractEntries.sort()).toEqual(
      ["PetContract.contract.json", "SummaryContract.contract.json"].sort(),
    );

    const runtimeEntries = await fs.readdir(path.join(outDir, "runtime"));
    expect(runtimeEntries).toEqual(expect.arrayContaining(["handlers.js", "rivet-runtime.js"]));
  });

  it("generated package.json has correct exports map", async () => {
    const outDir = path.join(tmpDir, "pkg");
    const { io } = captureIO();

    const exitCode = await runCli(
      [
        "build-local",
        "--entry",
        getFixturePath("handler-entrypoint/index.ts"),
        "--target",
        "browser",
        "--package-name",
        "@test/my-pkg",
        "--out",
        outDir,
      ],
      io,
    );

    expect(exitCode).toBe(0);

    const raw = await fs.readFile(path.join(outDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);

    expect(pkg.name).toBe("@test/my-pkg");
    expect(pkg.type).toBe("module");
    expect(pkg.exports["."]).toEqual({
      types: "./index.d.ts",
      import: "./index.js",
    });
    expect(pkg.exports["./client/pet"]).toEqual({
      types: "./client/pet.d.ts",
      import: "./client/pet.js",
    });
    expect(pkg.exports["./client/summary"]).toEqual({
      types: "./client/summary.d.ts",
      import: "./client/summary.js",
    });
    expect(pkg.exports["./contract/PetContract"]).toBe("./contract/PetContract.contract.json");
    expect(pkg.exports["./contract/SummaryContract"]).toBe(
      "./contract/SummaryContract.contract.json",
    );
  });

  it("generated package can be imported by a consumer TypeScript file that type-checks", async () => {
    const outDir = path.join(tmpDir, "pkg");
    const { io } = captureIO();

    const exitCode = await runCli(
      [
        "build-local",
        "--entry",
        getFixturePath("handler-entrypoint/index.ts"),
        "--target",
        "browser",
        "--package-name",
        "@test/my-pkg",
        "--out",
        outDir,
      ],
      io,
    );

    expect(exitCode).toBe(0);

    // Write a consumer TS file that imports the generated package
    const consumerDir = path.join(tmpDir, "consumer");
    await fs.mkdir(consumerDir, { recursive: true });

    const relativeToOutDir = path.relative(consumerDir, outDir).split(path.sep).join("/");

    await fs.writeFile(
      path.join(consumerDir, "consumer.ts"),
      [
        `import { pet, summary } from "${relativeToOutDir}/index.js";`,
        "",
        "const main = async () => {",
        "  const pets = await pet.ListPets();",
        "  const s = await summary.GetSummary();",
        "};",
        "",
        "main();",
        "",
      ].join("\n"),
    );

    await fs.writeFile(
      path.join(consumerDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            module: "nodenext",
            moduleResolution: "nodenext",
            target: "es2022",
            noEmit: true,
            skipLibCheck: true,
          },
          include: ["consumer.ts"],
        },
        null,
        2,
      ),
    );

    const tscPath = path.join(getProjectRoot(), "node_modules", ".bin", "tsc");
    const { stderr: tscStderr } = await execFileAsync(tscPath, ["--noEmit"], {
      cwd: consumerDir,
    });

    expect(tscStderr).toBe("");
  });

  it("existing reflect command still works unchanged", async () => {
    const outputPath = path.join(tmpDir, "contract.json");
    const { io, stderr } = captureIO();

    const exitCode = await runCli(
      [
        "--entry",
        getFixturePath(path.join("members-contract", "contracts.ts")),
        "--out",
        outputPath,
      ],
      io,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);

    const fileContents = await fs.readFile(outputPath, "utf8");
    const payload = JSON.parse(fileContents) as {
      endpoints: Array<{ name: string }>;
    };

    expect(payload.endpoints.length).toBeGreaterThan(0);
  });

  it("missing --entry flag produces usage error and exit code 1", async () => {
    const { io, stderr } = captureIO();

    const exitCode = await runCli(
      ["build-local", "--target", "browser", "--out", path.join(tmpDir, "out")],
      io,
    );

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("Usage:");
  });

  it("missing --out flag produces usage error and exit code 1", async () => {
    const { io, stderr } = captureIO();

    const exitCode = await runCli(
      [
        "build-local",
        "--entry",
        getFixturePath("handler-entrypoint/index.ts"),
        "--target",
        "browser",
      ],
      io,
    );

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("Usage:");
  });

  it("browser target with node-import fixture fails with diagnostic", async () => {
    const outDir = path.join(tmpDir, "pkg");
    const { io, stderr } = captureIO();

    const exitCode = await runCli(
      [
        "build-local",
        "--entry",
        getFixturePath("handler-entrypoint-node-import/index.ts"),
        "--target",
        "browser",
        "--package-name",
        "@test/node-pkg",
        "--out",
        outDir,
      ],
      io,
    );

    expect(exitCode).toBe(1);
    const stderrText = stderr.join("");
    expect(stderrText).toContain("node:");
  });
});
