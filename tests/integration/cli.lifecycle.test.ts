import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as tar from "tar";
import ts from "typescript";
import { lowerContracts } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { expectValidContractDocument } from "../contract-schema.js";
import { runCliCaptured } from "../support/cli.js";
import { writeContractProject } from "../support/contract-project.js";
import { parseContractJson } from "../support/lower.js";
import { AUTHORING_TYPES, PACKAGE_NAME, PROJECT_ROOT, fixturePath } from "../support/paths.js";
import { currentRid, installFakeRivet, useThrowawayRivetCache } from "../support/rivet-cache.js";
import { tempDir } from "../support/temp.js";

const execFileAsync = promisify(execFile);

/** The authoring type names `src/index.ts` re-exports, which users write contracts against. */
const authoringTypeExports = async (): Promise<readonly string[]> => {
  const indexPath = path.join(PROJECT_ROOT, "src", "index.ts");
  const index = ts.createSourceFile(
    indexPath,
    await fs.readFile(indexPath, "utf8"),
    ts.ScriptTarget.Latest,
  );
  return index.statements.flatMap((statement) =>
    ts.isExportDeclaration(statement) &&
    statement.moduleSpecifier !== undefined &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text === "./domain/authoring-types.js" &&
    statement.exportClause !== undefined &&
    ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.map((element) => element.name.text)
      : [],
  );
};

describe("CLI lowering", () => {
  it("writes the lowered contract JSON to --out, creating missing parent directories", async () => {
    const outputPath = path.join(await tempDir(), "deeply", "nested", "contract.json");
    const entryPath = fixturePath("members-contract", "contracts.ts");

    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      entryPath,
      "--out",
      outputPath,
    ]);

    expect({ exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const written = await fs.readFile(outputPath, "utf8");
    expect(written).toBe(`${lowerContracts(entryPath).toJson()}\n`);
    expectValidContractDocument(parseContractJson(written));
  });

  it("prints each diagnostic once on stderr, exits 1 and still writes the document", async () => {
    const entryPath = await writeContractProject({
      "contracts.ts": `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";

export interface TempContract extends Contract<"TempContract"> {
  Ping: Endpoint<{ method: "GET"; route: "/api/ping"; anonymous: true; security: { scheme: "admin" } }>;
}
`,
    });
    const outputPath = path.join(path.dirname(entryPath), "contract.json");

    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      entryPath,
      "--out",
      outputPath,
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    const lines = stderr.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^error: \[CONFLICTING_SECURITY_SPEC\] \S+:\d+:\d+ .*cannot declare both anonymous and security/,
    );
    expect(lines[0]).toContain(entryPath);
    expect(parseContractJson(await fs.readFile(outputPath, "utf8")).endpoints).toHaveLength(1);
  });

  it("supports the documented installed-consumer package import and CLI bins", async () => {
    const packDirectory = await tempDir("rivet-ts-pack-");
    const consumerDirectory = await tempDir("rivet-ts-consumer-");
    // `pnpm test` has just built dist/; skip prepack's clean rebuild, which
    // would delete dist/ under the suites running alongside this one.
    const { stdout: packStdout } = await execFileAsync(
      "pnpm",
      ["pack", "--pack-destination", packDirectory],
      { cwd: PROJECT_ROOT, env: { ...process.env, npm_config_ignore_scripts: "true" } },
    );
    const tarballName = packStdout.trim().split("\n").at(-1);
    if (!tarballName) {
      throw new Error("pnpm pack did not return a tarball name");
    }
    const tarballPath = path.isAbsolute(tarballName)
      ? tarballName
      : path.join(packDirectory, tarballName);

    const packedPaths: string[] = [];
    await tar.list({ file: tarballPath, onReadEntry: (entry) => packedPaths.push(entry.path) });
    expect(
      packedPaths.filter(
        (packed) =>
          !/^package\/(?:dist|templates\/example|templates\/shared)\//u.test(packed) &&
          packed !== "package/package.json" &&
          packed !== "package/README.md" &&
          packed !== "package/LICENSE",
      ),
    ).toEqual([]);
    expect(packedPaths).toContain("package/LICENSE");

    await fs.writeFile(
      path.join(consumerDirectory, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: { [PACKAGE_NAME]: tarballPath },
      }),
    );
    // pnpm >= 11 reads overrides from pnpm-workspace.yaml, not the package.json
    // "pnpm" field. Link the heavyweight deps from this repo's node_modules so
    // the install stays fast and works without registry metadata for them.
    await fs.writeFile(
      path.join(consumerDirectory, "pnpm-workspace.yaml"),
      `overrides:
  typescript: "file:${path.join(PROJECT_ROOT, "node_modules", "typescript")}"
  tar: "file:${path.join(PROJECT_ROOT, "node_modules", "tar")}"
`,
    );
    await execFileAsync("pnpm", ["install", "--prefer-offline"], { cwd: consumerDirectory });
    const run = (command: string, args: readonly string[]) =>
      execFileAsync(command, args, { cwd: consumerDirectory });

    // hono is an optional peer the consumer lacks: the root and vite entries must not import it.
    const typeofExports = async (exports: Readonly<Record<string, string>>) => {
      const script = Object.entries(exports)
        .map(([entry, name]) => `console.log(typeof (await import("${entry}")).${name});`)
        .join("\n");
      const { stdout } = await run("node", ["--input-type=module", "-e", script]);
      return stdout.trim().split("\n");
    };
    expect(
      await typeofExports({ [PACKAGE_NAME]: "runCli", [`${PACKAGE_NAME}/vite`]: "rivetTs" }),
    ).toEqual(["function", "function"]);

    await fs.symlink(
      path.join(PROJECT_ROOT, "node_modules", "hono"),
      path.join(consumerDirectory, "node_modules", "hono"),
      "dir",
    );
    expect(await typeofExports({ [`${PACKAGE_NAME}/hono`]: "registerRivetHonoRoutes" })).toEqual([
      "function",
    ]);

    const { stdout: cliVersion } = await run("pnpm", ["exec", "rivet-ts", "--version"]);
    const { version } = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf8"),
    ) as { version: string };
    expect(cliVersion.trim()).toBe(version);

    // Resolved through node_modules, as a consumer's tsconfig resolves it. No
    // skipLibCheck, and the optional vite peer is not installed: the root entry's
    // declarations must not reach vite's types.
    await fs.writeFile(
      path.join(consumerDirectory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
          noUnusedLocals: true,
        },
        include: ["contracts.ts", "authoring.ts"],
      }),
    );
    // Every authoring type the package exports, imported by name: `noUnusedLocals`
    // fails the check until a new export gets a usage below.
    const authoringExports = await authoringTypeExports();
    await fs.writeFile(
      path.join(consumerDirectory, "authoring.ts"),
      `import type { ${authoringExports.join(", ")} } from "${PACKAGE_NAME}";

type MemberId = Brand<string, "MemberId">;
type Email = Format<string, "email">;
type NewMember = { email: Email };

const method: EndpointAuthoringHttpMethod = "POST";
const notFound: EndpointErrorAuthoringSpec = { status: 404, description: "Not found" };
const admin: EndpointSecurityAuthoringSpec = { scheme: "admin" };
const scalar: EndpointExampleAuthoringScalar = "jane@example.com";
const value: EndpointExampleAuthoringValue = { email: scalar, tags: ["a", 1, null] };
const jane: EndpointExampleAuthoringReference<{ email: string }> = { email: "jane@example.com" };
const descriptor: EndpointRequestExampleAuthoringDescriptor = { name: "jane", mediaType: "application/json" };
const inline: InlineEndpointRequestExampleAuthoringSpec<{ email: string }> = { ...descriptor, json: jane };
const ref: RefEndpointRequestExampleAuthoringSpec<{ email: string }> = {
  componentExampleId: "Jane",
  resolvedJson: jane,
};
const requestExamples: readonly EndpointRequestExampleAuthoringSpec<{ email: string }>[] = [inline, ref];
const created: EndpointResponseExamplesAuthoringSpec<{ email: string }> = {
  status: 201,
  examples: [jane, inline],
};
const spec: EndpointAuthoringSpec = {
  method,
  route: "/api/members",
  errors: [notFound],
  security: admin,
  requestExamples,
  responseExamples: [created],
};

export interface MembersContract extends Contract<"Members"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/members";
    input: NewMember;
    response: { id: MemberId; email: Email };
    errors: [{ status: 404; description: "Not found" }];
    security: { scheme: "admin" };
  }>;
}

// @ts-expect-error a plain string is not a branded id
const unbranded: MemberId = "mem_1";

export const usages = [spec, value, unbranded];
`,
    );
    // tsc reports on stdout; a failure surfaces it instead of a bare exit code.
    await expect(
      execFileAsync(path.join(PROJECT_ROOT, "node_modules", ".bin", "tsc"), [
        "-p",
        path.join(consumerDirectory, "tsconfig.json"),
      ]).catch((error: { stdout: string }) => error.stdout),
    ).resolves.toEqual({ stdout: "", stderr: "" });
    await fs.writeFile(
      path.join(consumerDirectory, "contracts.ts"),
      `import type { Contract, Endpoint } from "@maxanstey-meridian/rivet-ts";

export interface HealthContract extends Contract<"HealthContract"> {
  Ping: Endpoint<{ method: "GET"; route: "/api/ping"; response: void }>;
}
`,
    );
    await run("pnpm", [
      "exec",
      "rivet-reflect-ts",
      "--entry",
      "contracts.ts",
      "--out",
      "contract.json",
    ]);
    const payload = parseContractJson(
      await fs.readFile(path.join(consumerDirectory, "contract.json"), "utf8"),
    );
    expect(payload.endpoints.map((endpoint) => endpoint.name)).toEqual(["ping"]);

    // The scaffold templates ship in the package, not only in the repo.
    await run("pnpm", ["exec", "rivet-ts", "scaffold", "--out", "scaffolded"]);
    await expect(
      fs.access(path.join(consumerDirectory, "scaffolded", "apps", "api", "src", "http-errors.ts")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(consumerDirectory, "scaffolded", "apps", "ui", "app", "app.vue")),
    ).resolves.toBeUndefined();
  });
});

describe("CLI argument handling and diagnostics", () => {
  it("prints usage for --help with exit code 0, covering every subcommand", async () => {
    const { exitCode, stdout, stderr } = await runCliCaptured(["--help"]);

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    const usage = stdout;
    expect(usage).toContain("Usage");
    expect(usage).toContain("rivet-ts --entry");
    expect(usage).toContain("scaffold-mock");
    expect(usage).toContain("generate --generated-root");
  });

  it("prints the package version for --version with exit code 0", async () => {
    const { version } = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf8"),
    ) as { version: string };

    const { exitCode, stdout, stderr } = await runCliCaptured(["--version"]);

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout).toContain(version);
  });

  it("fails loudly on an unknown flag instead of silently ignoring it", async () => {
    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      fixturePath("members-contract", "contracts.ts"),
      "--tsconfg",
      "tsconfig.json",
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(0);
    expect(stderr).toContain("Unknown option '--tsconfg'");
  });

  it("fails loudly on an unknown scaffold-mock flag", async () => {
    const { exitCode, stderr } = await runCliCaptured([
      "scaffold-mock",
      "--entry",
      "x.ts",
      "--out",
      "out",
      "--nme",
      "demo",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown option '--nme'");
  });

  it("fails loudly when --out is missing its value", async () => {
    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      fixturePath("members-contract", "contracts.ts"),
      "--out",
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(0);
    expect(stderr).toContain("Option '--out <value>' argument missing");
  });

  it("lowers with the tsconfig passed via --tsconfig", async () => {
    const entryPath = await writeContractProject(
      {
        "models/member.ts": "export interface MemberDto { id: string }\n",
        "contracts.ts": `import type { Contract, Endpoint } from "${AUTHORING_TYPES}";
import type { MemberDto } from "@models/member";

export interface MembersContract extends Contract<"MembersContract"> {
  List: Endpoint<{ method: "GET"; route: "/api/members"; response: MemberDto[] }>;
}
`,
        "tsconfig.contracts.json": JSON.stringify({
          compilerOptions: {
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            paths: { "@models/*": ["./models/*"] },
          },
        }),
      },
      "rivet-ts-lower-tsconfig-",
    );
    const tsconfigPath = path.join(path.dirname(entryPath), "tsconfig.contracts.json");

    const { exitCode, stdout, stderr } = await runCliCaptured([
      "--entry",
      entryPath,
      "--tsconfig",
      tsconfigPath,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const payload = parseContractJson(stdout);
    expect(payload.types.map((type) => type.name)).toEqual(["MemberDto"]);
  });

  it("warns on stderr when the entry contains no contracts", async () => {
    const tempDirectory = await tempDir("rivet-ts-no-contracts-");
    const entryPath = path.join(tempDirectory, "contracts.ts");
    await fs.writeFile(entryPath, "export interface NotAContract { id: string }\n", "utf8");

    const { exitCode, stderr } = await runCliCaptured(["--entry", entryPath]);

    expect(exitCode).toBe(0);
    const warningLines = stderr.split("\n").filter((line) => line.includes("[ENTRY_NO_CONTRACTS]"));
    expect(warningLines).toHaveLength(1);
    expect(warningLines[0]).toContain("warning");
    expect(warningLines[0]).toContain(entryPath);
    expect(warningLines[0]).toContain("contains no contracts");
  });

  it("reports a missing entry exactly once", async () => {
    const { exitCode, stderr } = await runCliCaptured([
      "--entry",
      "/definitely/does/not/exist/contracts.ts",
    ]);

    expect(exitCode).toBe(1);
    const entryNotFoundLines = stderr
      .split("\n")
      .filter((line) => line.includes("[ENTRY_NOT_FOUND]"));
    expect(entryNotFoundLines).toHaveLength(1);
  });
});

describe("rivet passthrough", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("streams more than 1 MB of Rivet output and keeps its exit code", async () => {
    const size = 2 * 1024 * 1024;
    await installFakeRivet(`process.stdout.write("x".repeat(${size}));`);

    const { exitCode, stdout, stderr } = await runCliCaptured(["rivet", "--from", "contract.json"]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(size);
  });

  it("passes --help and --version after the subcommand to the Rivet binary", async () => {
    await installFakeRivet('console.log(`fake-rivet ${process.argv.slice(2).join(" ")}`);');

    expect(await runCliCaptured(["rivet", "--", "--version"])).toEqual({
      exitCode: 0,
      stdout: "fake-rivet --version\n",
      stderr: "",
    });
    expect((await runCliCaptured(["rivet", "--help"])).stdout).toBe("fake-rivet --help\n");
  });

  it("reports a Rivet binary killed by a signal as 128 + the signal number", async () => {
    await installFakeRivet('process.kill(process.pid, "SIGTERM");');

    const { exitCode } = await runCliCaptured(["rivet"]);

    expect(exitCode).toBe(128 + os.constants.signals.SIGTERM);
  });

  it("forwards a non-zero Rivet exit code", async () => {
    await installFakeRivet('process.stderr.write("RIV1102: refused\\n"); process.exitCode = 3;');

    expect(await runCliCaptured(["rivet", "--from", "contract.json"])).toEqual({
      exitCode: 3,
      stdout: "",
      stderr: "RIV1102: refused\n",
    });
  });

  // An empty cache makes the passthrough download the pinned release; the
  // GitHub API and asset download are the only faked boundary.
  const serveFakeRelease = async (digest: "matching" | "wrong" | "missing"): Promise<string> => {
    const executablePath = await useThrowawayRivetCache();
    const rid = currentRid();
    const staging = await tempDir("rivet-ts-release-");
    await fs.writeFile(
      path.join(staging, `rivet-${rid}`),
      '#!/usr/bin/env node\nconsole.log("downloaded rivet");\n',
    );
    const archivePath = path.join(staging, `rivet-${rid}.tar.gz`);
    await tar.c({ gzip: true, file: archivePath, cwd: staging }, [`rivet-${rid}`]);
    const archive = await fs.readFile(archivePath);
    const sha256 = createHash("sha256").update(archive).digest("hex");

    const asset = {
      name: `rivet-${rid}.tar.gz`,
      browser_download_url: `https://downloads.invalid/rivet-${rid}.tar.gz`,
      ...(digest === "missing"
        ? {}
        : { digest: `sha256:${digest === "matching" ? sha256 : "0".repeat(64)}` }),
    };
    vi.stubGlobal("fetch", async (url: string) =>
      url.startsWith("https://api.github.com/")
        ? Response.json({ assets: [asset] })
        : new Response(archive),
    );
    return executablePath;
  };

  it("downloads, verifies and runs the pinned release on first use", async () => {
    const executablePath = await serveFakeRelease("matching");

    expect(await runCliCaptured(["rivet"])).toEqual({
      exitCode: 0,
      stdout: "downloaded rivet\n",
      stderr: "",
    });
    await expect(fs.access(executablePath)).resolves.toBeUndefined();
  });

  it("refuses a release asset whose digest does not match", async () => {
    const executablePath = await serveFakeRelease("wrong");

    const { exitCode, stderr } = await runCliCaptured(["rivet"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("digest mismatch");
    await expect(fs.access(executablePath)).rejects.toThrow();
  });

  it("refuses a release asset without a published digest", async () => {
    const executablePath = await serveFakeRelease("missing");

    const { exitCode, stderr } = await runCliCaptured(["rivet"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("publishes no sha256 digest");
    await expect(fs.access(executablePath)).rejects.toThrow();
  });
});
