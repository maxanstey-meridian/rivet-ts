import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type {
  RivetContractEnum,
  RivetType,
  RivetTypeDefinition,
} from "../../src/domain/rivet-contract.js";
import {
  emitTypeExpression,
  emitTypeDefinition,
  emitEnumDeclaration,
} from "../../src/infrastructure/codegen/rivet-type-to-typescript.js";

const execFileAsync = promisify(execFile);

const getFixturePath = (relativePath: string): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "fixtures", relativePath);
};

const readJsonFixture = async (relativePath: string): Promise<unknown> => {
  const fileContents = await fs.readFile(getFixturePath(relativePath), "utf8");
  return JSON.parse(fileContents) as unknown;
};

const tscPath = path.resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "node_modules",
  ".bin",
  "tsc",
);

const tscValidate = async (source: string, prefix: string): Promise<void> => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `rivet-emit-${prefix}-`));
  const tmpFile = path.join(tmpDir, "emitted.ts");
  await fs.writeFile(tmpFile, source, "utf8");

  try {
    await execFileAsync(tscPath, [
      "--noEmit",
      "--strict",
      "--target",
      "ES2020",
      "--module",
      "ES2020",
      "--ignoreConfig",
      tmpFile,
    ]);
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    throw new Error(`tsc failed:\n${err.stdout ?? ""}\n${err.stderr ?? ""}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true });
  }
};

// -- emitTypeExpression tests --

describe("emitTypeExpression", () => {
  describe("primitive kinds", () => {
    it("emits string", () => {
      const type: RivetType = { kind: "primitive", type: "string" };
      expect(emitTypeExpression(type)).toBe("string");
    });

    it("emits number", () => {
      const type: RivetType = { kind: "primitive", type: "number" };
      expect(emitTypeExpression(type)).toBe("number");
    });

    it("emits boolean", () => {
      const type: RivetType = { kind: "primitive", type: "boolean" };
      expect(emitTypeExpression(type)).toBe("boolean");
    });

    it("emits File", () => {
      const type: RivetType = { kind: "primitive", type: "File" };
      expect(emitTypeExpression(type)).toBe("File");
    });

    it("emits unknown", () => {
      const type: RivetType = { kind: "primitive", type: "unknown" };
      expect(emitTypeExpression(type)).toBe("unknown");
    });

    it("ignores format and csharpType metadata", () => {
      const type: RivetType = {
        kind: "primitive",
        type: "string",
        format: "uuid",
        csharpType: "Guid",
      };
      expect(emitTypeExpression(type)).toBe("string");
    });
  });

  describe("nullable, array, dictionary", () => {
    it("emits nullable as T | null", () => {
      const type: RivetType = { kind: "nullable", inner: { kind: "primitive", type: "string" } };
      expect(emitTypeExpression(type)).toBe("string | null");
    });

    it("emits array as T[]", () => {
      const type: RivetType = { kind: "array", element: { kind: "primitive", type: "number" } };
      expect(emitTypeExpression(type)).toBe("number[]");
    });

    it("wraps nullable element in parens for array", () => {
      const type: RivetType = {
        kind: "array",
        element: { kind: "nullable", inner: { kind: "primitive", type: "string" } },
      };
      expect(emitTypeExpression(type)).toBe("(string | null)[]");
    });

    it("wraps string union element in parens for array", () => {
      const type: RivetType = {
        kind: "array",
        element: { kind: "stringUnion", values: ["a", "b"] },
      };
      expect(emitTypeExpression(type)).toBe('("a" | "b")[]');
    });

    it("emits dictionary as Record<string, T>", () => {
      const type: RivetType = { kind: "dictionary", value: { kind: "primitive", type: "number" } };
      expect(emitTypeExpression(type)).toBe("Record<string, number>");
    });

    it("emits nested dictionary with array value", () => {
      const type: RivetType = {
        kind: "dictionary",
        value: { kind: "array", element: { kind: "primitive", type: "string" } },
      };
      expect(emitTypeExpression(type)).toBe("Record<string, string[]>");
    });
  });

  describe("string union and int union", () => {
    it("emits string union as literal union", () => {
      const type: RivetType = { kind: "stringUnion", values: ["active", "suspended"] };
      expect(emitTypeExpression(type)).toBe('"active" | "suspended"');
    });

    it("emits single-value string union", () => {
      const type: RivetType = { kind: "stringUnion", values: ["hidden"] };
      expect(emitTypeExpression(type)).toBe('"hidden"');
    });

    it("emits int union as numeric literal union", () => {
      const type: RivetType = { kind: "intUnion", values: [1, 2, 3] };
      expect(emitTypeExpression(type)).toBe("1 | 2 | 3");
    });

    it("escapes special characters in string union values", () => {
      const type: RivetType = { kind: "stringUnion", values: ['say "hello"', "back\\slash"] };
      expect(emitTypeExpression(type)).toBe('"say \\"hello\\"" | "back\\\\slash"');
    });
  });

  describe("inline object", () => {
    it("emits inline object with properties", () => {
      const type: RivetType = {
        kind: "inlineObject",
        properties: [
          { name: "lat", type: { kind: "primitive", type: "number" } },
          { name: "lng", type: { kind: "primitive", type: "number" } },
        ],
      };
      expect(emitTypeExpression(type)).toBe(
        "{\n  readonly lat: number;\n  readonly lng: number;\n}",
      );
    });

    it("emits empty inline object", () => {
      const type: RivetType = { kind: "inlineObject", properties: [] };
      expect(emitTypeExpression(type)).toBe("{}");
    });
  });

  describe("tagged union", () => {
    it("emits tagged union as union of variant types", () => {
      const type: RivetType = {
        kind: "taggedUnion",
        discriminator: "kind",
        variants: [
          {
            tag: "circle",
            type: {
              kind: "inlineObject",
              properties: [
                { name: "kind", type: { kind: "stringUnion", values: ["circle"] } },
                { name: "radius", type: { kind: "primitive", type: "number" } },
              ],
            },
          },
          {
            tag: "rect",
            type: {
              kind: "inlineObject",
              properties: [
                { name: "kind", type: { kind: "stringUnion", values: ["rect"] } },
                { name: "width", type: { kind: "primitive", type: "number" } },
                { name: "height", type: { kind: "primitive", type: "number" } },
              ],
            },
          },
        ],
      };
      const result = emitTypeExpression(type);
      expect(result).toContain('readonly kind: "circle"');
      expect(result).toContain("readonly radius: number");
      expect(result).toContain('readonly kind: "rect"');
      expect(result).toContain("readonly width: number");
      expect(result).toContain(" | ");
    });
  });

  describe("ref, generic, typeParam, brand", () => {
    it("emits ref as the type name", () => {
      const type: RivetType = { kind: "ref", name: "MemberDto" };
      expect(emitTypeExpression(type)).toBe("MemberDto");
    });

    it("emits generic with type arguments", () => {
      const type: RivetType = {
        kind: "generic",
        name: "PagedResult",
        typeArgs: [{ kind: "ref", name: "MemberDto" }],
      };
      expect(emitTypeExpression(type)).toBe("PagedResult<MemberDto>");
    });

    it("emits generic with multiple type arguments", () => {
      const type: RivetType = {
        kind: "generic",
        name: "Map",
        typeArgs: [
          { kind: "primitive", type: "string" },
          { kind: "ref", name: "MemberDto" },
        ],
      };
      expect(emitTypeExpression(type)).toBe("Map<string, MemberDto>");
    });

    it("emits typeParam as the parameter name", () => {
      const type: RivetType = { kind: "typeParam", name: "TData" };
      expect(emitTypeExpression(type)).toBe("TData");
    });

    it("emits brand as intersection with __brand", () => {
      const type: RivetType = {
        kind: "brand",
        name: "EmailAddress",
        underlying: { kind: "primitive", type: "string" },
      };
      expect(emitTypeExpression(type)).toBe('string & { readonly __brand: "EmailAddress" }');
    });

    it("wraps nullable underlying in parens for brand", () => {
      const type: RivetType = {
        kind: "brand",
        name: "OptionalId",
        underlying: { kind: "nullable", inner: { kind: "primitive", type: "string" } },
      };
      expect(emitTypeExpression(type)).toBe('(string | null) & { readonly __brand: "OptionalId" }');
    });
  });
});

// -- emitTypeDefinition tests --

describe("emitTypeDefinition", () => {
  it("emits interface with properties", () => {
    const typeDef: RivetTypeDefinition = {
      name: "MemberDto",
      typeParameters: [],
      properties: [
        {
          name: "id",
          type: { kind: "primitive", type: "string" },
          optional: false,
          readOnly: true,
        },
        { name: "email", type: { kind: "primitive", type: "string" }, optional: false },
        { name: "nickname", type: { kind: "primitive", type: "string" }, optional: true },
      ],
    };
    const result = emitTypeDefinition(typeDef);
    expect(result).toBe(
      "export interface MemberDto {\n" +
        "  readonly id: string;\n" +
        "  email: string;\n" +
        "  nickname?: string;\n" +
        "}",
    );
  });

  it("emits generic interface with type parameters", () => {
    const typeDef: RivetTypeDefinition = {
      name: "PagedResult",
      typeParameters: ["TItem"],
      properties: [
        {
          name: "items",
          type: { kind: "array", element: { kind: "typeParam", name: "TItem" } },
          optional: false,
        },
        { name: "totalCount", type: { kind: "primitive", type: "number" }, optional: false },
      ],
    };
    const result = emitTypeDefinition(typeDef);
    expect(result).toContain("export interface PagedResult<TItem>");
    expect(result).toContain("items: TItem[]");
    expect(result).toContain("totalCount: number");
  });

  it("emits type alias when type field is set", () => {
    const typeDef: RivetTypeDefinition = {
      name: "Shape",
      typeParameters: [],
      properties: [],
      type: {
        kind: "taggedUnion",
        discriminator: "kind",
        variants: [
          {
            tag: "circle",
            type: {
              kind: "inlineObject",
              properties: [
                { name: "kind", type: { kind: "stringUnion", values: ["circle"] } },
                { name: "radius", type: { kind: "primitive", type: "number" } },
              ],
            },
          },
        ],
      },
    };
    const result = emitTypeDefinition(typeDef);
    expect(result).toMatch(/^export type Shape = /);
    expect(result).toContain('readonly kind: "circle"');
    expect(result).toContain("readonly radius: number");
    expect(result).toMatch(/;$/);
  });

  it("emits empty interface", () => {
    const typeDef: RivetTypeDefinition = {
      name: "Empty",
      typeParameters: [],
      properties: [],
    };
    expect(emitTypeDefinition(typeDef)).toBe("export interface Empty {}");
  });

  it("emits generic type alias with type parameters", () => {
    const typeDef: RivetTypeDefinition = {
      name: "Wrapped",
      typeParameters: ["T"],
      properties: [],
      type: { kind: "generic", name: "Promise", typeArgs: [{ kind: "typeParam", name: "T" }] },
    };
    const result = emitTypeDefinition(typeDef);
    expect(result).toBe("export type Wrapped<T> = Promise<T>;");
  });
});

// -- emitEnumDeclaration tests --

describe("emitEnumDeclaration", () => {
  it("emits string union type alias", () => {
    const rivetEnum: RivetContractEnum = { name: "MemberStatus", values: ["active", "suspended"] };
    const result = emitEnumDeclaration(rivetEnum);
    expect(result).toBe('export type MemberStatus = "active" | "suspended";');
  });

  it("emits int union type alias", () => {
    const rivetEnum: RivetContractEnum = { name: "MemberPriority", intValues: [1, 2, 3] };
    const result = emitEnumDeclaration(rivetEnum);
    expect(result).toBe("export type MemberPriority = 1 | 2 | 3;");
  });
});

// -- Round-trip test --

describe("round-trip: golden fixture to TS source validates with tsc", () => {
  it("emits expressive-contract fixture as valid TypeScript", async () => {
    const golden = (await readJsonFixture(
      path.join("expressive-contract", "golden-contract.json"),
    )) as {
      types: RivetTypeDefinition[];
      enums: RivetContractEnum[];
    };

    const lines: string[] = [];

    for (const rivetEnum of golden.enums) {
      lines.push(emitEnumDeclaration(rivetEnum));
      lines.push("");
    }

    for (const typeDef of golden.types) {
      lines.push(emitTypeDefinition(typeDef));
      lines.push("");
    }

    const source = lines.join("\n");

    await tscValidate(source, "expressive");
  });

  it("emits tagged union contract as valid TypeScript", async () => {
    // The tagged-union fixture doesn't have a golden JSON file,
    // so we extract and lower it to get the RivetContractDocument
    const { TypeScriptContractFrontend } =
      await import("../../src/infrastructure/typescript/typescript-contract-frontend.js");
    const { TypeScriptRivetContractLowerer } =
      await import("../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js");
    const { ExtractTsContracts } =
      await import("../../src/application/use-cases/extract-ts-contracts.js");
    const { LowerContractBundleToRivetContract } =
      await import("../../src/application/use-cases/lower-contract-bundle-to-rivet-contract.js");

    const frontend = new TypeScriptContractFrontend();
    const lowerer = new TypeScriptRivetContractLowerer();
    const extractUseCase = new ExtractTsContracts(frontend);
    const lowerUseCase = new LowerContractBundleToRivetContract(lowerer);

    const bundle = await extractUseCase.execute({
      entryPath: getFixturePath(path.join("tagged-union-contract", "contracts.ts")),
    });
    const lowered = await lowerUseCase.execute({ bundle });
    expect(lowered.hasErrors).toBe(false);

    const doc = JSON.parse(lowered.toJson()) as {
      types: RivetTypeDefinition[];
      enums: RivetContractEnum[];
    };

    const lines: string[] = [];

    for (const rivetEnum of doc.enums) {
      lines.push(emitEnumDeclaration(rivetEnum));
      lines.push("");
    }

    for (const typeDef of doc.types) {
      lines.push(emitTypeDefinition(typeDef));
      lines.push("");
    }

    const source = lines.join("\n");

    // Verify we actually got a tagged union in the lowered output
    const hasTaggedUnion = doc.types.some((t) => t.type?.kind === "taggedUnion");
    expect(hasTaggedUnion).toBe(true);

    await tscValidate(source, "tagged");
  });
});
