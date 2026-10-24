import fs from "node:fs/promises";
import { z } from "zod";

/**
 * Values whose types the compiler cannot know (JSON text, dynamically
 * imported modules, rejection reasons), checked at runtime against a schema
 * instead of asserted.
 */

export const parseJson = <TSchema extends z.ZodType>(
  text: string,
  schema: TSchema,
): z.output<TSchema> => schema.parse(JSON.parse(text));

export const readJsonFile = async <TSchema extends z.ZodType>(
  filePath: string,
  schema: TSchema,
): Promise<z.output<TSchema>> => parseJson(await fs.readFile(filePath, "utf8"), schema);

export const importModule = async <TSchema extends z.ZodType>(
  modulePath: string,
  schema: TSchema,
): Promise<z.output<TSchema>> => schema.parse(await import(modulePath));

/**
 * A class or function export. Only "is a function" can be checked at runtime,
 * so the signature is the one the test declares, as an import's would be.
 */
export const newable = <TClass extends abstract new (...args: never[]) => unknown>() =>
  z.custom<TClass>((value) => typeof value === "function");

export const fn = <TFunction extends (...args: never[]) => unknown>() =>
  z.custom<TFunction>((value) => typeof value === "function");

const ExecFailure = z.object({ stdout: z.string().optional(), stderr: z.string().optional() });

/** What a failed `execFile` printed: the `stdout`/`stderr` it attaches to its error. */
export const execFailureOutput = (error: unknown): { stdout: string; stderr: string } => {
  const parsed = ExecFailure.safeParse(error);
  return {
    stdout: parsed.data?.stdout ?? "",
    stderr: parsed.data?.stderr ?? (parsed.success ? "" : String(error)),
  };
};
