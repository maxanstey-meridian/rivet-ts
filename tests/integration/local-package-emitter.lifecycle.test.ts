import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GeneratedClientModule } from "../../src/domain/generated-client-module.js";
import {
  RivetContractDocument,
  RivetEndpointDefinition,
  RivetResponseType,
} from "../../src/domain/rivet-contract.js";
import { LocalPackageEmitter } from "../../src/infrastructure/package/local-package-emitter.js";
import type { PackageEmitterConfig } from "../../src/application/ports/package-emitter.js";

const makePetClientModule = (): GeneratedClientModule =>
  new GeneratedClientModule({
    handlerGroupExportName: "petHandlers",
    clientName: "pet",
    jsSource:
      'import { createDirectClient } from "../runtime/rivet-runtime.js";\nimport { petHandlers } from "../runtime/handlers.js";\nexport const pet = createDirectClient(petHandlers);\n',
    dtsSource:
      'export declare const pet: { ListPets(): Promise<{ id: string; name: string }[]> };\n',
  });

const makeSummaryClientModule = (): GeneratedClientModule =>
  new GeneratedClientModule({
    handlerGroupExportName: "summaryHandlers",
    clientName: "summary",
    jsSource:
      'import { createDirectClient } from "../runtime/rivet-runtime.js";\nimport { summaryHandlers } from "../runtime/handlers.js";\nexport const summary = createDirectClient(summaryHandlers);\n',
    dtsSource:
      'export declare const summary: { GetSummary(): Promise<{ total: number }> };\n',
  });

const makePetContractDoc = (): RivetContractDocument =>
  new RivetContractDocument({
    endpoints: [
      new RivetEndpointDefinition({
        name: "listPets",
        httpMethod: "GET",
        routeTemplate: "/api/pets",
        params: [],
        controllerName: "PetContract",
        responses: [new RivetResponseType({ statusCode: 200 })],
      }),
    ],
  });

const makeSummaryContractDoc = (): RivetContractDocument =>
  new RivetContractDocument({
    endpoints: [
      new RivetEndpointDefinition({
        name: "getSummary",
        httpMethod: "GET",
        routeTemplate: "/api/summary",
        params: [],
        controllerName: "SummaryContract",
        responses: [new RivetResponseType({ statusCode: 200 })],
      }),
    ],
  });

const makeBundleFiles = (): Map<string, string> =>
  new Map([
    ["handlers.js", 'export const petHandlers = {};\nexport const summaryHandlers = {};\n'],
    [
      "rivet-runtime.js",
      'export const createDirectClient = (h) => h;\nexport class RivetError extends Error {}\n',
    ],
    ["chunk-ABC123.js", "// shared chunk\n"],
  ]);

const makeConfig = (outDir: string): PackageEmitterConfig => ({
  outDir,
  packageName: "@test/my-handlers",
  target: "browser",
  clientModules: [makePetClientModule(), makeSummaryClientModule()],
  bundleFiles: makeBundleFiles(),
  contractDocuments: new Map([
    ["PetContract", makePetContractDoc()],
    ["SummaryContract", makeSummaryContractDoc()],
  ]),
});

describe("LocalPackageEmitter", () => {
  const emitter = new LocalPackageEmitter();
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rivet-emit-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("generates package.json with correct structure and exports map", async () => {
    const outDir = path.join(tmpDir, "pkg");
    await emitter.emit(makeConfig(outDir));

    const raw = await fs.readFile(path.join(outDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);

    expect(pkg.name).toBe("@test/my-handlers");
    expect(pkg.version).toBe("0.0.0");
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
    expect(pkg.exports["./types"]).toEqual({
      types: "./types/index.d.ts",
      import: "./types/index.js",
    });
    expect(pkg.exports["./contract/PetContract"]).toBe(
      "./contract/PetContract.contract.json",
    );
    expect(pkg.exports["./contract/SummaryContract"]).toBe(
      "./contract/SummaryContract.contract.json",
    );

    expect(pkg.rivet).toEqual({
      kind: "local-package",
      target: "browser",
    });
  });

  it("generates index.js that re-exports all clients", async () => {
    const outDir = path.join(tmpDir, "pkg");
    await emitter.emit(makeConfig(outDir));

    const indexJs = await fs.readFile(path.join(outDir, "index.js"), "utf-8");
    expect(indexJs).toContain('export { pet } from "./client/pet.js"');
    expect(indexJs).toContain('export { summary } from "./client/summary.js"');
  });

  it("generates index.d.ts that mirrors index.js exports", async () => {
    const outDir = path.join(tmpDir, "pkg");
    await emitter.emit(makeConfig(outDir));

    const indexDts = await fs.readFile(path.join(outDir, "index.d.ts"), "utf-8");
    expect(indexDts).toContain('export { pet } from "./client/pet.js"');
    expect(indexDts).toContain('export { summary } from "./client/summary.js"');
    expect(indexDts).toContain('export type * from "./types/index.js"');
  });

  it("writes client JS and DTS files from generated modules", async () => {
    const outDir = path.join(tmpDir, "pkg");
    await emitter.emit(makeConfig(outDir));

    const petJs = await fs.readFile(path.join(outDir, "client", "pet.js"), "utf-8");
    expect(petJs).toContain("createDirectClient");
    expect(petJs).toContain("petHandlers");

    const petDts = await fs.readFile(path.join(outDir, "client", "pet.d.ts"), "utf-8");
    expect(petDts).toContain("export declare const pet");

    const summaryJs = await fs.readFile(
      path.join(outDir, "client", "summary.js"),
      "utf-8",
    );
    expect(summaryJs).toContain("summaryHandlers");

    const summaryDts = await fs.readFile(
      path.join(outDir, "client", "summary.d.ts"),
      "utf-8",
    );
    expect(summaryDts).toContain("export declare const summary");
  });

  it("writes runtime bundle files preserving relative paths", async () => {
    const outDir = path.join(tmpDir, "pkg");
    await emitter.emit(makeConfig(outDir));

    const handlersJs = await fs.readFile(
      path.join(outDir, "runtime", "handlers.js"),
      "utf-8",
    );
    expect(handlersJs).toContain("petHandlers");

    const runtimeJs = await fs.readFile(
      path.join(outDir, "runtime", "rivet-runtime.js"),
      "utf-8",
    );
    expect(runtimeJs).toContain("createDirectClient");

    const chunkJs = await fs.readFile(
      path.join(outDir, "runtime", "chunk-ABC123.js"),
      "utf-8",
    );
    expect(chunkJs).toContain("shared chunk");
  });

  it("writes contract JSON files matching input documents", async () => {
    const outDir = path.join(tmpDir, "pkg");
    await emitter.emit(makeConfig(outDir));

    const petRaw = await fs.readFile(
      path.join(outDir, "contract", "PetContract.contract.json"),
      "utf-8",
    );
    const petContract = JSON.parse(petRaw);
    expect(petContract.endpoints).toHaveLength(1);
    expect(petContract.endpoints[0].name).toBe("listPets");
    expect(petContract.endpoints[0].httpMethod).toBe("GET");
    expect(petContract.endpoints[0].routeTemplate).toBe("/api/pets");

    const summaryRaw = await fs.readFile(
      path.join(outDir, "contract", "SummaryContract.contract.json"),
      "utf-8",
    );
    const summaryContract = JSON.parse(summaryRaw);
    expect(summaryContract.endpoints).toHaveLength(1);
    expect(summaryContract.endpoints[0].name).toBe("getSummary");
  });

  it("produces expected directory structure", async () => {
    const outDir = path.join(tmpDir, "pkg");
    await emitter.emit(makeConfig(outDir));

    const entries = await fs.readdir(outDir);
    expect(entries.sort()).toEqual(
      ["client", "contract", "index.d.ts", "index.js", "package.json", "runtime", "types"].sort(),
    );

    const clientEntries = await fs.readdir(path.join(outDir, "client"));
    expect(clientEntries.sort()).toEqual(
      ["pet.d.ts", "pet.js", "summary.d.ts", "summary.js"].sort(),
    );

    const runtimeEntries = await fs.readdir(path.join(outDir, "runtime"));
    expect(runtimeEntries.sort()).toEqual(
      ["chunk-ABC123.js", "handlers.js", "rivet-runtime.js"].sort(),
    );

    const contractEntries = await fs.readdir(path.join(outDir, "contract"));
    expect(contractEntries.sort()).toEqual(
      ["PetContract.contract.json", "SummaryContract.contract.json"].sort(),
    );

    const typesEntries = await fs.readdir(path.join(outDir, "types"));
    expect(typesEntries.sort()).toEqual(["index.d.ts", "index.js"].sort());
  });
});
