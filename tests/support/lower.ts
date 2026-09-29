import type { RivetContractLoweringResult } from "../../src/domain/rivet-contract-lowering-result.js";
import type { RivetContractDocument } from "../../src/domain/rivet-contract.js";
import { lowerContracts } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { writeContractProject } from "./contract-project.js";
import { fixturePath } from "./paths.js";

type Json<T> = T extends (...args: never) => unknown
  ? never
  : T extends readonly (infer TElement)[]
    ? readonly Json<TElement>[]
    : T extends object
      ? {
          readonly [TKey in keyof T as T[TKey] extends (...args: never) => unknown
            ? never
            : TKey]: Json<T[TKey]>;
        }
      : T;

/** Contract JSON as `toJson()` and the CLI write it: the domain document's data. */
export type ContractJson = Json<RivetContractDocument>;

export const parseContractJson = (text: string): ContractJson => JSON.parse(text);

export type LoweredEntry = {
  readonly entryPath: string;
  readonly lowered: RivetContractLoweringResult;
  readonly document: ContractJson;
};

const lowerEntry = (entryPath: string): LoweredEntry => {
  const lowered = lowerContracts(entryPath);
  return { entryPath, lowered, document: parseContractJson(lowered.toJson()) };
};

export const lowerFixture = (name: string): LoweredEntry =>
  lowerEntry(fixturePath(name, "contracts.ts"));

/** Lowers `contracts` as the entry of a throwaway project holding `siblings` beside it. */
export const lowerSource = async (
  contracts: string,
  siblings: Readonly<Record<string, string>> = {},
): Promise<LoweredEntry> =>
  lowerEntry(await writeContractProject({ ...siblings, "contracts.ts": contracts }));
