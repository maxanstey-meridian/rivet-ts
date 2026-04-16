import path from "node:path";
import { fileURLToPath } from "node:url";
import { EsbuildImplementationBundler } from "../../src/infrastructure/bundler/esbuild-implementation-bundler.js";
import { HandlerGroup } from "../../src/domain/handler-group.js";

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

const makePetGroup = (fixtureDir: string): HandlerGroup =>
  new HandlerGroup({
    exportName: "petHandlers",
    contractName: "PetContract",
    contractSourcePath: path.join(fixtureDir, "pet-contract.ts"),
    handlerSourcePath: path.join(fixtureDir, "pet.handlers.ts"),
    endpointNames: ["ListPets", "CreatePet"],
  });

const makeSummaryGroup = (fixtureDir: string): HandlerGroup =>
  new HandlerGroup({
    exportName: "summaryHandlers",
    contractName: "SummaryContract",
    contractSourcePath: path.join(fixtureDir, "summary-contract.ts"),
    handlerSourcePath: path.join(fixtureDir, "summary.handlers.ts"),
    endpointNames: ["GetSummary"],
  });

const makeNodeGroup = (fixtureDir: string): HandlerGroup =>
  new HandlerGroup({
    exportName: "nodeHandlers",
    contractName: "NodeContract",
    contractSourcePath: path.join(fixtureDir, "node-contract.ts"),
    handlerSourcePath: path.join(fixtureDir, "node.handlers.ts"),
    endpointNames: ["ReadFile"],
  });

describe("EsbuildImplementationBundler", () => {
  const bundler = new EsbuildImplementationBundler();
  const handlerFixtureDir = getFixturePath("handler-entrypoint");
  const nodeImportFixtureDir = getFixturePath("handler-entrypoint-node-import");

  it("bundles handler-entrypoint fixture for browser target", async () => {
    const entryPath = path.join(handlerFixtureDir, "index.ts");
    const groups = [makePetGroup(handlerFixtureDir), makeSummaryGroup(handlerFixtureDir)];

    const result = await bundler.bundle(entryPath, groups, "browser", "/tmp/test-bundle-out");

    expect(result.hasErrors).toBe(false);
    expect(result.outputFiles.size).toBeGreaterThanOrEqual(2);
    expect(result.outputFiles.has("handlers.js")).toBe(true);
    expect(result.outputFiles.has("rivet-runtime.js")).toBe(true);
  });

  it("bundled handler output contains handler group exports", async () => {
    const entryPath = path.join(handlerFixtureDir, "index.ts");
    const groups = [makePetGroup(handlerFixtureDir), makeSummaryGroup(handlerFixtureDir)];

    const result = await bundler.bundle(entryPath, groups, "browser", "/tmp/test-bundle-out");

    const handlersJs = result.outputFiles.get("handlers.js")!;
    expect(handlersJs).toContain("petHandlers");
    expect(handlersJs).toContain("summaryHandlers");
  });

  it("bundled runtime output contains runtime exports", async () => {
    const entryPath = path.join(handlerFixtureDir, "index.ts");
    const groups = [makePetGroup(handlerFixtureDir), makeSummaryGroup(handlerFixtureDir)];

    const result = await bundler.bundle(entryPath, groups, "browser", "/tmp/test-bundle-out");

    const runtimeJs = result.outputFiles.get("rivet-runtime.js")!;
    expect(runtimeJs).toContain("createDirectClient");
    expect(runtimeJs).toContain("RivetError");
    expect(runtimeJs).toContain("defineHandlers");
  });

  it("bundles successfully for node target", async () => {
    const entryPath = path.join(handlerFixtureDir, "index.ts");
    const groups = [makePetGroup(handlerFixtureDir), makeSummaryGroup(handlerFixtureDir)];

    const result = await bundler.bundle(entryPath, groups, "node", "/tmp/test-bundle-out");

    expect(result.hasErrors).toBe(false);
    expect(result.outputFiles.size).toBeGreaterThanOrEqual(2);
  });

  it("browser target fails with diagnostic when handler imports node:fs", async () => {
    const entryPath = path.join(nodeImportFixtureDir, "index.ts");
    const groups = [makeNodeGroup(nodeImportFixtureDir)];

    const result = await bundler.bundle(entryPath, groups, "browser", "/tmp/test-bundle-out");

    expect(result.hasErrors).toBe(true);
    expect(result.diagnostics.length).toBeGreaterThan(0);

    const nodeBuiltinDiagnostic = result.diagnostics.find((d) =>
      d.message.includes("node:fs"),
    );
    expect(nodeBuiltinDiagnostic).toBeDefined();
    expect(nodeBuiltinDiagnostic!.severity).toBe("error");
    expect(nodeBuiltinDiagnostic!.code).toBe("BUNDLE_ERROR");
  });

  it("node target succeeds with node:fs imports", async () => {
    const entryPath = path.join(nodeImportFixtureDir, "index.ts");
    const groups = [makeNodeGroup(nodeImportFixtureDir)];

    const result = await bundler.bundle(entryPath, groups, "node", "/tmp/test-bundle-out");

    expect(result.hasErrors).toBe(false);
    expect(result.outputFiles.size).toBeGreaterThanOrEqual(1);
  });

  it("bundled output is valid ESM (no require calls)", async () => {
    const entryPath = path.join(handlerFixtureDir, "index.ts");
    const groups = [makePetGroup(handlerFixtureDir), makeSummaryGroup(handlerFixtureDir)];

    const result = await bundler.bundle(entryPath, groups, "browser", "/tmp/test-bundle-out");

    for (const [, content] of result.outputFiles) {
      const requireMatches = content.match(/\brequire\s*\(/g);
      expect(requireMatches).toBeNull();
    }
  });

  it("output files have no errors for empty diagnostic list on success", async () => {
    const entryPath = path.join(handlerFixtureDir, "index.ts");
    const groups = [makePetGroup(handlerFixtureDir), makeSummaryGroup(handlerFixtureDir)];

    const result = await bundler.bundle(entryPath, groups, "browser", "/tmp/test-bundle-out");

    expect(result.diagnostics).toHaveLength(0);
  });
});
