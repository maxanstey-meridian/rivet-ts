// X-section fixtures (FABLE_TEST_FIXES Part II.D T5): one fixture + test per
// extraction-pipeline finding in FABLE_REVIEW.md. The conversion rule under
// test: silent wrong output is never acceptable — each unsupported construct
// either works correctly or produces a loud diagnostic with a location.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LowerTsContractsToRivetContract } from "../../src/application/use-cases/lower-ts-contracts-to-rivet-contract.js";
import { TypeScriptRivetContractLowerer } from "../../src/infrastructure/typescript/typescript-rivet-contract-lowerer.js";
import { expectValidContractDocument } from "../contract-schema.js";

type DocumentPayload = {
  types: Array<{
    name: string;
    properties?: Array<{
      name: string;
      optional?: boolean;
      type: Record<string, unknown>;
    }>;
  }>;
  enums: Array<{ name: string; values?: string[]; intValues?: number[] }>;
  endpoints: Array<{
    name: string;
    params: Array<{
      name: string;
      source: string;
      isOptional: boolean;
      type: Record<string, unknown>;
    }>;
    responses: Array<{ statusCode: number }>;
  }>;
};

const getProjectRoot = (): string => {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "..");
};

const toImportPath = (fromDirectory: string, targetFilePath: string): string => {
  const relativePath = path.relative(fromDirectory, targetFilePath).split(path.sep).join("/");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
};

const writeFixtureProject = async (
  prefix: string,
  files: Record<string, readonly string[]>,
): Promise<{ tempDirectory: string; entryPath: string }> => {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const normalizedImportPath = toImportPath(
    tempDirectory,
    path.join(getProjectRoot(), "dist", "index.js"),
  );

  await fs.writeFile(path.join(tempDirectory, "package.json"), '{ "type": "module" }\n', "utf8");

  for (const [fileName, lines] of Object.entries(files)) {
    await fs.writeFile(
      path.join(tempDirectory, fileName),
      lines.join("\n").replaceAll("__IMPORT_PATH__", normalizedImportPath),
      "utf8",
    );
  }

  return { tempDirectory, entryPath: path.join(tempDirectory, "contracts.ts") };
};

const extractAndLower = async (entryPath: string) => {
  const lowerer = new TypeScriptRivetContractLowerer();
  const lowered = await new LowerTsContractsToRivetContract(lowerer).execute({ entryPath });
  return { lowered };
};

describe("X-section extraction pipeline fixtures", () => {
  // X1: spec alias declared in a second file — the frontend previously read
  // node text with the entry SourceFile, corrupting the extracted bundle.
  it("X1: extracts cross-file endpoint-spec aliases without corrupting text or numerics", async () => {
    const { entryPath } = await writeFixtureProject("rivet-ts-x1-cross-file-spec-", {
      "specs.ts": [
        "export interface UserDto {",
        "  id: string;",
        "}",
        "",
        "export type ListUsersSpec = {",
        '  method: "GET";',
        '  route: "/api/users";',
        "  successStatus: 202;",
        "  response: UserDto[];",
        "};",
        "",
      ],
      "contracts.ts": [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        'import type { ListUsersSpec } from "./specs.js";',
        "",
        'export interface UsersContract extends Contract<"UsersContract"> {',
        "  List: Endpoint<ListUsersSpec>;",
        "}",
        "",
      ],
    });

    const { lowered } = await extractAndLower(entryPath);

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);
    const payload = JSON.parse(lowered.toJson()) as DocumentPayload;
    expectValidContractDocument(payload);
    expect(payload.endpoints[0]?.responses.map((response) => response.statusCode)).toEqual([202]);
  });

  // X2: generic spec aliases previously lowered the literal type parameter
  // name ("T") and still emitted the endpoint.
  it("X2: rejects generic endpoint-spec aliases with a located diagnostic instead of lowering 'T'", async () => {
    const { entryPath } = await writeFixtureProject("rivet-ts-x2-generic-spec-", {
      "contracts.ts": [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        "export interface MemberDto {",
        "  id: string;",
        "}",
        "",
        "type CrudSpec<T> = {",
        '  method: "GET";',
        '  route: "/api/members";',
        "  response: T;",
        "};",
        "",
        'export interface MembersContract extends Contract<"MembersContract"> {',
        "  List: Endpoint<CrudSpec<MemberDto>>;",
        "}",
        "",
      ],
    });

    const { lowered } = await extractAndLower(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_GENERIC_ENDPOINT_SPEC",
          filePath: entryPath,
          line: expect.any(Number),
        }),
      ]),
    );
    // The endpoint must not survive into the document.
    const payload = JSON.parse(lowered.toJson()) as DocumentPayload;
    expect(payload.endpoints).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain('"T"');
  });

  // X3/X4/X7 (happy path): buildExplicitEndpointParams had zero coverage.
  it("X3/X4/X7: lowers explicit params:/query: declarations with correct sources and optionality", async () => {
    const { entryPath } = await writeFixtureProject("rivet-ts-x3-explicit-params-", {
      "contracts.ts": [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        "export interface ItemDto {",
        "  id: number;",
        "  name: string;",
        "}",
        "",
        'export interface ItemsContract extends Contract<"ItemsContract"> {',
        "  Get: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/items/{id}";',
        "    params: { id: number };",
        "    query: { search?: string };",
        "    response: ItemDto;",
        "  }>;",
        "}",
        "",
      ],
    });

    const { lowered } = await extractAndLower(entryPath);

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);

    const payload = JSON.parse(lowered.toJson()) as DocumentPayload;
    expectValidContractDocument(payload);
    const get = payload.endpoints.find((endpoint) => endpoint.name === "get");
    expect(get?.params).toEqual([
      expect.objectContaining({
        name: "id",
        source: "route",
        isOptional: false,
        type: { kind: "primitive", type: "number" },
      }),
      expect.objectContaining({
        name: "search",
        source: "query",
        isOptional: true,
        type: { kind: "primitive", type: "string" },
      }),
    ]);
  });

  // X3: route placeholders with no matching input property previously
  // vanished on non-body methods with an input type.
  it("X3: emits fallback route params for placeholders missing from a GET input type", async () => {
    const { entryPath } = await writeFixtureProject("rivet-ts-x3-input-route-param-", {
      "contracts.ts": [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        "export interface SearchQuery {",
        "  q: string;",
        "}",
        "",
        'export interface PostsContract extends Contract<"PostsContract"> {',
        "  Search: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/users/{id}/posts";',
        "    input: SearchQuery;",
        "    response: void;",
        "  }>;",
        "}",
        "",
      ],
    });

    const { lowered } = await extractAndLower(entryPath);

    expect(lowered.hasErrors).toBe(false);

    const payload = JSON.parse(lowered.toJson()) as DocumentPayload;
    expectValidContractDocument(payload);
    const search = payload.endpoints.find((endpoint) => endpoint.name === "search");
    expect(search?.params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "id",
          source: "route",
          type: { kind: "primitive", type: "string" },
        }),
        expect.objectContaining({ name: "q", source: "query" }),
      ]),
    );
  });

  // X3 (explicit branch): placeholders missing from params: previously
  // vanished as well.
  it("X3: emits fallback route params for placeholders missing from explicit params:", async () => {
    const { entryPath } = await writeFixtureProject("rivet-ts-x3-explicit-route-param-", {
      "contracts.ts": [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        'export interface ItemsContract extends Contract<"ItemsContract"> {',
        "  Get: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/items/{id}/sub/{subId}";',
        "    params: { id: number };",
        "    response: void;",
        "  }>;",
        "}",
        "",
      ],
    });

    const { lowered } = await extractAndLower(entryPath);

    expect(lowered.hasErrors).toBe(false);
    const payload = JSON.parse(lowered.toJson()) as DocumentPayload;
    const get = payload.endpoints.find((endpoint) => endpoint.name === "get");
    expect(get?.params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "id",
          source: "route",
          type: { kind: "primitive", type: "number" },
        }),
        expect.objectContaining({
          name: "subId",
          source: "route",
          type: { kind: "primitive", type: "string" },
        }),
      ]),
    );
  });

  // X4: non-object-literal explicit params:/query: were silently discarded.
  it("X4: reports a located diagnostic for non-object explicit query: types instead of dropping them", async () => {
    const { entryPath } = await writeFixtureProject("rivet-ts-x4-mapped-query-", {
      "contracts.ts": [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        "export interface UserFilter {",
        "  status: string;",
        "  role: string;",
        "}",
        "",
        'export type UserParams = Pick<UserFilter, "status">;',
        "",
        'export interface UsersContract extends Contract<"UsersContract"> {',
        "  List: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/users";',
        "    query: UserParams;",
        "    response: void;",
        "  }>;",
        "}",
        "",
      ],
    });

    const { lowered } = await extractAndLower(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_QUERY_SHAPE",
          filePath: entryPath,
          line: expect.any(Number),
        }),
      ]),
    );
  });

  // X7: acceptsFile endpoints with explicit params:/query: bypassed all
  // multipart handling and emitted internally contradictory output.
  it("X7: reports a located diagnostic when acceptsFile is combined with explicit params:/query:", async () => {
    const { entryPath } = await writeFixtureProject("rivet-ts-x7-multipart-query-", {
      "contracts.ts": [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        "export interface UploadInput {",
        "  file: Blob;",
        "  label: string;",
        "}",
        "",
        'export interface UploadsContract extends Contract<"UploadsContract"> {',
        "  Upload: Endpoint<{",
        '    method: "POST";',
        '    route: "/api/upload";',
        "    input: UploadInput;",
        "    query: { overwrite?: boolean };",
        "    acceptsFile: true;",
        "    response: void;",
        "  }>;",
        "}",
        "",
      ],
    });

    const { lowered } = await extractAndLower(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_MULTIPART_INPUT",
          filePath: entryPath,
          line: expect.any(Number),
        }),
      ]),
    );
  });

  // X5: interface inheritance silently dropped inherited properties.
  it("X5: flattens inherited interface properties into the lowered DTO", async () => {
    const { entryPath } = await writeFixtureProject("rivet-ts-x5-extends-", {
      "contracts.ts": [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        "export interface BaseDto {",
        "  id: string;",
        "  createdAt: string;",
        "}",
        "",
        "export interface UserDto extends BaseDto {",
        "  email: string;",
        "}",
        "",
        'export interface UsersContract extends Contract<"UsersContract"> {',
        "  Get: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/users";',
        "    response: UserDto;",
        "  }>;",
        "}",
        "",
      ],
    });

    const { lowered } = await extractAndLower(entryPath);

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);

    const payload = JSON.parse(lowered.toJson()) as DocumentPayload;
    expectValidContractDocument(payload);
    const userDto = payload.types.find((type) => type.name === "UserDto");
    expect(userDto?.properties?.map((property) => property.name).sort()).toEqual([
      "createdAt",
      "email",
      "id",
    ]);
  });

  // X6: renamed Contract imports previously skipped the contract silently.
  it("X6: extracts contracts declared via a renamed Contract import", async () => {
    const { entryPath } = await writeFixtureProject("rivet-ts-x6-renamed-import-", {
      "contracts.ts": [
        'import type { Contract as C, Endpoint } from "__IMPORT_PATH__";',
        "",
        'export interface UsersContract extends C<"UsersContract"> {',
        "  Ping: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/ping";',
        "    response: void;",
        "  }>;",
        "}",
        "",
      ],
    });

    const { lowered } = await extractAndLower(entryPath);

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);
    expect(lowered.contracts).toHaveLength(1);
    expect(lowered.contracts[0]?.name).toBe("UsersContract");
    const payload = JSON.parse(lowered.toJson()) as DocumentPayload;
    expect(payload.endpoints.map((endpoint) => endpoint.name)).toEqual(["ping"]);
  });

  // X6: non-literal Contract<...> arguments previously skipped the contract
  // silently as well.
  it("X6: reports a located diagnostic for a non-literal Contract<Name> argument", async () => {
    const { entryPath } = await writeFixtureProject("rivet-ts-x6-non-literal-name-", {
      "contracts.ts": [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        'type Name = "UsersContract";',
        "",
        "export interface UsersContract extends Contract<Name> {",
        "  Ping: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/ping";',
        "    response: void;",
        "  }>;",
        "}",
        "",
      ],
    });

    const { lowered } = await extractAndLower(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_CONTRACT_NAME",
          filePath: entryPath,
          line: expect.any(Number),
        }),
      ]),
    );
  });

  // X8: Date is declared in lib .d.ts files the lowerer never indexes, so it
  // previously emitted a dangling ref plus a context-free TYPE_NOT_FOUND.
  it("X8: lowers Date properties to string with date-time format", async () => {
    const { entryPath } = await writeFixtureProject("rivet-ts-x8-date-", {
      "contracts.ts": [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        "export interface EventDto {",
        "  id: string;",
        "  occurredAt: Date;",
        "}",
        "",
        'export interface EventsContract extends Contract<"EventsContract"> {',
        "  List: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/events";',
        "    response: EventDto[];",
        "  }>;",
        "}",
        "",
      ],
    });

    const { lowered } = await extractAndLower(entryPath);

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);

    const payload = JSON.parse(lowered.toJson()) as DocumentPayload;
    expectValidContractDocument(payload);
    const eventDto = payload.types.find((type) => type.name === "EventDto");
    expect(eventDto?.properties?.find((property) => property.name === "occurredAt")?.type).toEqual({
      kind: "primitive",
      type: "string",
      format: "date-time",
    });
  });

  // X9: two same-named exported DTOs in different files must not be merged
  // silently — a located DUPLICATE_TYPE_NAME diagnostic is the contract.
  it("X9: reports a located diagnostic for duplicate type names across files", async () => {
    const { entryPath, tempDirectory } = await writeFixtureProject("rivet-ts-x9-duplicate-", {
      "warehouse.ts": ["export interface Item {", "  sku: string;", "}", ""],
      "catalog.ts": ["export interface Item {", "  code: number;", "}", ""],
      "contracts.ts": [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        'import type { Item } from "./warehouse.js";',
        'import type { Item as CatalogItem } from "./catalog.js";',
        "",
        'export interface ItemsContract extends Contract<"ItemsContract"> {',
        "  GetWarehouseItem: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/warehouse-item";',
        "    response: Item;",
        "  }>;",
        "  GetCatalogItem: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/catalog-item";',
        "    response: CatalogItem;",
        "  }>;",
        "}",
        "",
      ],
    });

    const { lowered } = await extractAndLower(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DUPLICATE_TYPE_NAME",
          filePath: expect.stringContaining(tempDirectory),
          line: expect.any(Number),
        }),
      ]),
    );
  });

  // X10: `string | undefined` should lower as an optional string property.
  it("X10: lowers `string | undefined` properties as optional string", async () => {
    const { entryPath } = await writeFixtureProject("rivet-ts-x10-undefined-union-", {
      "contracts.ts": [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        "export interface ProfileDto {",
        "  name: string;",
        "  nickname: string | undefined;",
        "}",
        "",
        'export interface ProfilesContract extends Contract<"ProfilesContract"> {',
        "  Get: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/profile";',
        "    response: ProfileDto;",
        "  }>;",
        "}",
        "",
      ],
    });

    const { lowered } = await extractAndLower(entryPath);

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);

    const payload = JSON.parse(lowered.toJson()) as DocumentPayload;
    expectValidContractDocument(payload);
    const profileDto = payload.types.find((type) => type.name === "ProfileDto");
    expect(profileDto?.properties?.find((property) => property.name === "nickname")).toMatchObject({
      optional: true,
      type: { kind: "primitive", type: "string" },
    });
  });

  // X10: `A | B | null` should lower as a nullable tagged union.
  it("X10: lowers `A | B | null` as a nullable tagged union", async () => {
    const { entryPath } = await writeFixtureProject("rivet-ts-x10-nullable-union-", {
      "contracts.ts": [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        "export interface OwnerDto {",
        '  pet: { kind: "dog"; bark: boolean } | { kind: "cat"; meow: boolean } | null;',
        "}",
        "",
        'export interface OwnersContract extends Contract<"OwnersContract"> {',
        "  Get: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/owner";',
        "    response: OwnerDto;",
        "  }>;",
        "}",
        "",
      ],
    });

    const { lowered } = await extractAndLower(entryPath);

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);

    const payload = JSON.parse(lowered.toJson()) as DocumentPayload;
    expectValidContractDocument(payload);
    const ownerDto = payload.types.find((type) => type.name === "OwnerDto");
    const pet = ownerDto?.properties?.find((property) => property.name === "pet");
    expect(pet?.type).toMatchObject({
      kind: "nullable",
      inner: expect.objectContaining({
        kind: "taggedUnion",
        discriminator: "kind",
        variants: [
          expect.objectContaining({ tag: "dog" }),
          expect.objectContaining({ tag: "cat" }),
        ],
      }),
    });
  });

  // X16: idiomatic auto-numbered enums previously rejected the whole enum.
  it("X16: lowers auto-numbered and negative enum members with computed values", async () => {
    const { entryPath } = await writeFixtureProject("rivet-ts-x16-auto-enum-", {
      "contracts.ts": [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        "export enum Role {",
        "  Admin,",
        "  User,",
        "}",
        "",
        "export enum Offset {",
        "  Behind = -1,",
        "  Zero,",
        "  Ahead,",
        "}",
        "",
        "export interface MemberDto {",
        "  role: Role;",
        "  offset: Offset;",
        "}",
        "",
        'export interface MembersContract extends Contract<"MembersContract"> {',
        "  Get: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/member";',
        "    response: MemberDto;",
        "  }>;",
        "}",
        "",
      ],
    });

    const { lowered } = await extractAndLower(entryPath);

    expect(lowered.hasErrors).toBe(false);
    expect(lowered.diagnostics).toEqual([]);

    const payload = JSON.parse(lowered.toJson()) as DocumentPayload;
    expectValidContractDocument(payload);
    expect(payload.enums.find((entry) => entry.name === "Role")?.intValues).toEqual([0, 1]);
    expect(payload.enums.find((entry) => entry.name === "Offset")?.intValues).toEqual([-1, 0, 1]);
  });

  // X23: Contract<""> previously slipped through extraction and surfaced
  // later as a confusing CONTRACT_NOT_FOUND during lowering.
  it("X23: reports a located diagnostic for an empty contract name", async () => {
    const { entryPath } = await writeFixtureProject("rivet-ts-x23-empty-name-", {
      "contracts.ts": [
        'import type { Contract, Endpoint } from "__IMPORT_PATH__";',
        "",
        'export interface NamelessContract extends Contract<""> {',
        "  Ping: Endpoint<{",
        '    method: "GET";',
        '    route: "/api/ping";',
        "    response: void;",
        "  }>;",
        "}",
        "",
      ],
    });

    const { lowered } = await extractAndLower(entryPath);

    expect(lowered.hasErrors).toBe(true);
    expect(lowered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_CONTRACT_NAME",
          filePath: entryPath,
          line: expect.any(Number),
        }),
      ]),
    );
    expect(lowered.contracts).toEqual([]);
  });
});
