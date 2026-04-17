import path from "node:path";

const toModuleImportPath = (fromFilePath: string, targetFilePath: string): string => {
  const relativePath = path.relative(path.dirname(fromFilePath), targetFilePath).split(path.sep).join("/");
  const importPath = relativePath.startsWith(".") ? relativePath : `./${relativePath}`;

  return importPath
    .replace(/\.tsx?$/u, ".js")
    .replace(/\.mts$/u, ".mjs")
    .replace(/\.cts$/u, ".cjs");
};

export const emitLocalRivetSource = (config: {
  readonly filePath: string;
  readonly appFilePath: string;
  readonly generatedRivetFilePath: string;
}): string => {
  const appImportPath = toModuleImportPath(config.filePath, config.appFilePath);
  const generatedRivetImportPath = toModuleImportPath(
    config.filePath,
    config.generatedRivetFilePath,
  );

  return [
    `import { app } from ${JSON.stringify(appImportPath)};`,
    `import { configureRivet as configureGeneratedRivet, type RivetConfig } from ${JSON.stringify(generatedRivetImportPath)};`,
    "",
    'type LocalRivetConfig = Omit<RivetConfig, "fetch" | "baseUrl"> & {',
    "  readonly baseUrl?: string;",
    "};",
    "",
    "export const configureLocalRivet = (config: LocalRivetConfig = {}): void => {",
    "  configureGeneratedRivet({",
    "    ...config,",
    '    baseUrl: config.baseUrl ?? "http://local",',
    "    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(app.request(input as string, init)),",
    "  });",
    "};",
    "",
  ].join("\n");
};
