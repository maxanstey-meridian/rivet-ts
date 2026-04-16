export class ScaffoldMockConfig {
  public readonly entryPath: string;
  public readonly outDir: string;
  public readonly projectName?: string;
  public readonly tsconfigPath?: string;

  public constructor(input: {
    entryPath: string;
    outDir: string;
    projectName?: string;
    tsconfigPath?: string;
  }) {
    this.entryPath = input.entryPath;
    this.outDir = input.outDir;
    this.projectName = input.projectName;
    this.tsconfigPath = input.tsconfigPath;
  }
}
