export class HandlerGroup {
  public readonly exportName: string;
  public readonly contractName: string;
  public readonly contractSourcePath: string;
  public readonly handlerSourcePath: string;
  public readonly endpointNames: readonly string[];

  public constructor(input: {
    exportName: string;
    contractName: string;
    contractSourcePath: string;
    handlerSourcePath: string;
    endpointNames: readonly string[];
  }) {
    this.exportName = input.exportName;
    this.contractName = input.contractName;
    this.contractSourcePath = input.contractSourcePath;
    this.handlerSourcePath = input.handlerSourcePath;
    this.endpointNames = input.endpointNames;
  }
}
