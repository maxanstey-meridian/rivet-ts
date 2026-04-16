export type BuildLocalTarget = "browser" | "node";

export class BuildLocalConfig {
  public readonly entryPath: string;
  public readonly target: BuildLocalTarget;
  public readonly packageName: string;
  public readonly outDir: string;
  public readonly tsconfigPath: string | undefined;

  public constructor(input: {
    entryPath: string;
    target: BuildLocalTarget;
    packageName: string;
    outDir: string;
    tsconfigPath?: string;
  }) {
    this.entryPath = input.entryPath;
    this.target = input.target;
    this.packageName = input.packageName;
    this.outDir = input.outDir;
    this.tsconfigPath = input.tsconfigPath;
  }
}
