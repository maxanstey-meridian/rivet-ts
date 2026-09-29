import { resolveRivetBinaryConfig } from "../../src/config/rivet-binary.js";

describe("resolveRivetBinaryConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ignores an invalid RIVET_VERSION when an explicit version or binaryPath makes it unused", () => {
    vi.stubEnv("RIVET_VERSION", "latest");

    expect(resolveRivetBinaryConfig({ version: "0.44.1" }).version).toBe("0.44.1");
    expect(resolveRivetBinaryConfig({ binaryPath: "/opt/rivet" }).binaryPath).toBe("/opt/rivet");
  });

  it("refuses an invalid RIVET_VERSION when it names the release", () => {
    vi.stubEnv("RIVET_VERSION", "latest");

    expect(() => resolveRivetBinaryConfig()).toThrow(
      'RIVET_VERSION must be a Rivet release version such as 0.44.1; got "latest".',
    );
  });
});
