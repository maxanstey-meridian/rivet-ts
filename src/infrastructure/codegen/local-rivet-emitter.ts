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

export const emitPublicApiSource = (config: {
  readonly filePath: string;
  readonly generatedLocalRivetFilePath: string;
  readonly generatedRivetClientIndexFilePath: string;
  readonly generatedRivetRuntimeFilePath: string;
}): string => {
  const localRivetImportPath = toModuleImportPath(
    config.filePath,
    config.generatedLocalRivetFilePath,
  );
  const generatedRivetClientImportPath = toModuleImportPath(
    config.filePath,
    config.generatedRivetClientIndexFilePath,
  );
  const generatedRivetRuntimeImportPath = toModuleImportPath(
    config.filePath,
    config.generatedRivetRuntimeFilePath,
  );

  return [
    `export { configureLocalRivet } from ${JSON.stringify(localRivetImportPath)};`,
    `export * from ${JSON.stringify(generatedRivetClientImportPath)};`,
    `export { configureRivet, type RivetConfig, RivetError } from ${JSON.stringify(generatedRivetRuntimeImportPath)};`,
    "",
  ].join("\n");
};
