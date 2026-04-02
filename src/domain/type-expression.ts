export class TypeExpression {
  public readonly text: string;
  public readonly referencedSymbols: readonly string[];

  public constructor(text: string, referencedSymbols: readonly string[]) {
    this.text = text;
    this.referencedSymbols = referencedSymbols;
  }
}
