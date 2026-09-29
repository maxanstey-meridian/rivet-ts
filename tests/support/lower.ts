import type { RivetContractDocument } from "../../src/domain/rivet-contract.js";

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
