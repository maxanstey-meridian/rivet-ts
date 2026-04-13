import { expect, expectTypeOf, test } from "vitest";
import type { Contract, Endpoint } from "../../src/domain/authoring-types.js";
import {
  handle,
  type ContractEndpointKey,
  type RivetHandler,
} from "../../src/domain/handler-types.js";
import {
  RivetError,
  createDirectClient,
  defineHandlers,
  type DirectClient,
  type RivetEndpointResult,
  type RivetHandlerMap,
  type RivetResult,
  type RivetSuccessResult,
} from "../../src/domain/runtime-types.js";

// -- DTOs --

interface AddRequest {
  readonly a: number;
  readonly b: number;
}

interface AddResponse {
  readonly sum: number;
}

interface DivideRequest {
  readonly dividend: number;
  readonly divisor: number;
}

interface DivideResponse {
  readonly quotient: number;
}

interface HealthResponse {
  readonly status: "ok";
}

interface CreateResponse {
  readonly id: string;
}

// -- Contracts --

interface MathContract extends Contract<"MathContract"> {
  Add: Endpoint<{
    method: "POST";
    route: "/api/math/add";
    input: AddRequest;
    response: AddResponse;
  }>;
}

interface DivideContract extends Contract<"DivideContract"> {
  Divide: Endpoint<{
    method: "POST";
    route: "/api/math/divide";
    input: DivideRequest;
    response: DivideResponse;
    errors: [{ status: 400; response: { message: string } }];
  }>;
}

interface HealthContract extends Contract<"HealthContract"> {
  Health: Endpoint<{
    method: "GET";
    route: "/api/health";
    response: HealthResponse;
  }>;
}

interface FileContract extends Contract<"FileContract"> {
  Export: Endpoint<{
    method: "GET";
    route: "/api/export";
    fileResponse: true;
  }>;
}

interface VoidContract extends Contract<"VoidContract"> {
  Ping: Endpoint<{
    method: "POST";
    route: "/api/ping";
    response: void;
  }>;
}

interface CreatedContract extends Contract<"CreatedContract"> {
  Create: Endpoint<{
    method: "POST";
    route: "/api/create";
    input: { readonly name: string };
    response: CreateResponse;
    successStatus: 201;
  }>;
}

// -- Type tests --

test("RivetSuccessResult extracts status 200 and response type", () => {
  expectTypeOf<RivetSuccessResult<MathContract, "Add">>().toEqualTypeOf<{
    readonly status: 200;
    readonly data: AddResponse;
  }>();
});

test("RivetEndpointResult for success-only endpoint equals success result", () => {
  expectTypeOf<RivetEndpointResult<MathContract, "Add">>().toEqualTypeOf<{
    readonly status: 200;
    readonly data: AddResponse;
  }>();
});

test("RivetEndpointResult for error-bearing endpoint is a discriminated union", () => {
  expectTypeOf<RivetEndpointResult<DivideContract, "Divide">>().toEqualTypeOf<
    | { readonly status: 200; readonly data: DivideResponse }
    | { readonly status: 400; readonly data: { message: string } }
  >();
});

test("RivetSuccessResult for inputless endpoint resolves correctly", () => {
  expectTypeOf<RivetSuccessResult<HealthContract, "Health">>().toEqualTypeOf<{
    readonly status: 200;
    readonly data: HealthResponse;
  }>();
});

test("RivetSuccessResult with custom successStatus uses that literal", () => {
  expectTypeOf<RivetSuccessResult<CreatedContract, "Create">>().toEqualTypeOf<{
    readonly status: 201;
    readonly data: CreateResponse;
  }>();
});

test("RivetSuccessResult with fileResponse resolves data to Blob", () => {
  expectTypeOf<RivetSuccessResult<FileContract, "Export">>().toEqualTypeOf<{
    readonly status: 200;
    readonly data: Blob;
  }>();
});

test("RivetSuccessResult with void response resolves data to void", () => {
  expectTypeOf<RivetSuccessResult<VoidContract, "Ping">>().toEqualTypeOf<{
    readonly status: 200;
    readonly data: void;
  }>();
});

test("RivetResult is a simple status+data envelope", () => {
  expectTypeOf<RivetResult<string>>().toEqualTypeOf<{
    readonly status: number;
    readonly data: string;
  }>();
});

// -- Runtime tests --

// -- defineHandlers DTOs + Contract --

interface DirectorySearchRequest {
  readonly query: string;
  readonly page: number;
}

interface DirectorySearchResponse {
  readonly items: readonly { readonly id: string; readonly displayName: string }[];
  readonly totalCount: number;
}

interface DirectoryStatusResponse {
  readonly status: "ok";
}

interface FormSubmission {
  readonly name: string;
  readonly email: string;
}

interface DirectoryContract extends Contract<"DirectoryContract"> {
  Search: Endpoint<{
    method: "POST";
    route: "/api/directory/search";
    input: DirectorySearchRequest;
    response: DirectorySearchResponse;
  }>;

  Health: Endpoint<{
    method: "GET";
    route: "/api/directory/health";
    response: DirectoryStatusResponse;
  }>;

  Export: Endpoint<{
    method: "POST";
    route: "/api/directory/export";
    input: DirectorySearchRequest;
    response: void;
    fileResponse: true;
    fileContentType: "text/csv";
  }>;

  SubmitForm: Endpoint<{
    method: "POST";
    route: "/api/directory/form";
    input: FormSubmission;
    response: void;
    formEncoded: true;
  }>;
}

// -- defineHandlers tests --

test("defineHandlers compiles with all endpoint handlers", () => {
  const handlers = defineHandlers<DirectoryContract>()({
    Search: handle<DirectoryContract, "Search">(async ({ body }) => ({
      items: [{ id: "1", displayName: body.query }],
      totalCount: body.page,
    })),
    Health: handle<DirectoryContract, "Health">(async () => ({
      status: "ok" as const,
    })),
    Export: handle<DirectoryContract, "Export">(async ({ body }) =>
      new Blob([body.query], { type: "text/csv" }),
    ),
    SubmitForm: handle<DirectoryContract, "SubmitForm">(async () => {
      void 0;
    }),
  });

  expectTypeOf(handlers.Search).toEqualTypeOf<RivetHandler<DirectoryContract, "Search">>();
  expectTypeOf(handlers.Health).toEqualTypeOf<RivetHandler<DirectoryContract, "Health">>();
});

test("RivetHandlerMap has a key for each contract endpoint", () => {
  type Keys = keyof RivetHandlerMap<DirectoryContract>;
  expectTypeOf<Keys>().toEqualTypeOf<ContractEndpointKey<DirectoryContract>>();
});

test("defineHandlers rejects missing keys, extra keys, and wrong return types", () => {
  void 0;

  // @ts-expect-error missing Health key
  defineHandlers<DirectoryContract>()({
    Search: handle<DirectoryContract, "Search">(async ({ body }) => ({
      items: [{ id: "1", displayName: body.query }],
      totalCount: body.page,
    })),
    Export: handle<DirectoryContract, "Export">(async ({ body }) =>
      new Blob([body.query], { type: "text/csv" }),
    ),
    SubmitForm: handle<DirectoryContract, "SubmitForm">(async () => {
      void 0;
    }),
  });

  defineHandlers<DirectoryContract>()({
    Search: handle<DirectoryContract, "Search">(async ({ body }) => ({
      items: [{ id: "1", displayName: body.query }],
      totalCount: body.page,
    })),
    Health: handle<DirectoryContract, "Health">(async () => ({
      status: "ok" as const,
    })),
    Export: handle<DirectoryContract, "Export">(async ({ body }) =>
      new Blob([body.query], { type: "text/csv" }),
    ),
    SubmitForm: handle<DirectoryContract, "SubmitForm">(async () => {
      void 0;
    }),
    // @ts-expect-error extra Bogus key not in contract resolves to never
    Bogus: handle<DirectoryContract, "Health">(async () => ({
      status: "ok" as const,
    })),
  });

  defineHandlers<DirectoryContract>()({
    // @ts-expect-error wrong return type for Search handler
    Search: handle<DirectoryContract, "Search">(async () => ({
      wrong: true,
    })),
    Health: handle<DirectoryContract, "Health">(async () => ({
      status: "ok" as const,
    })),
    Export: handle<DirectoryContract, "Export">(async ({ body }) =>
      new Blob([body.query], { type: "text/csv" }),
    ),
    SubmitForm: handle<DirectoryContract, "SubmitForm">(async () => {
      void 0;
    }),
  });
});

// -- Runtime tests --

test("RivetError extends Error and stores result", () => {
  const error = new RivetError({ status: 400, data: { message: "bad" } });

  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(RivetError);
  expect(error.message).toBe("RivetError");
  expect(error.result.status).toBe(400);
  expect(error.result.data).toEqual({ message: "bad" });
});

// -- createDirectClient DTOs + Contracts --

interface PingResponse {
  readonly pong: true;
}

interface PingContract extends Contract<"PingContract"> {
  Ping: Endpoint<{
    method: "GET";
    route: "/api/ping";
    response: PingResponse;
  }>;
}

// -- createDirectClient type tests --

test("DirectClient method for input endpoint accepts flat DTO", () => {
  expectTypeOf<DirectClient<MathContract>["Add"]>()
    .parameter(0)
    .toEqualTypeOf<AddRequest>();
});

test("DirectClient method for input endpoint returns Promise<SuccessResponse>", () => {
  expectTypeOf<DirectClient<MathContract>["Add"]>()
    .returns
    .toEqualTypeOf<Promise<AddResponse>>();
});

test("DirectClient method for inputless endpoint takes no args", () => {
  expectTypeOf<DirectClient<PingContract>["Ping"]>()
    .parameters
    .toEqualTypeOf<[]>();
});

test("DirectClient method for inputless endpoint returns Promise<SuccessResponse>", () => {
  expectTypeOf<DirectClient<PingContract>["Ping"]>()
    .returns
    .toEqualTypeOf<Promise<PingResponse>>();
});

// -- createDirectClient runtime tests --

test("createDirectClient routes input endpoint call through handler", async () => {
  const handlers = defineHandlers<MathContract>()({
    Add: handle<MathContract, "Add">(async ({ body }) => ({
      sum: body.a + body.b,
    })),
  });

  const client = createDirectClient<MathContract>(handlers);
  const result = await client.Add({ a: 3, b: 4 });

  expect(result).toEqual({ sum: 7 });
});

test("createDirectClient routes inputless endpoint call through handler", async () => {
  const handlers = defineHandlers<PingContract>()({
    Ping: handle<PingContract, "Ping">(async () => ({
      pong: true as const,
    })),
  });

  const client = createDirectClient<PingContract>(handlers);
  const result = await client.Ping();

  expect(result).toEqual({ pong: true });
});

test("createDirectClient does not expose keys outside the contract", () => {
  const handlers = defineHandlers<MathContract>()({
    Add: handle<MathContract, "Add">(async ({ body }) => ({
      sum: body.a + body.b,
    })),
  });

  const client = createDirectClient<MathContract>(handlers);

  // @ts-expect-error Bogus is not a key of MathContract
  void client.Bogus;
});

// -- unwrap: false type tests --

test("unwrap: false on success-only endpoint returns RivetEndpointResult (collapses to success)", () => {
  const handlers = defineHandlers<MathContract>()({
    Add: handle<MathContract, "Add">(async ({ body }) => ({
      sum: body.a + body.b,
    })),
  });

  const client = createDirectClient<MathContract>(handlers);

  expectTypeOf(client.Add({ a: 1, b: 2 }, { unwrap: false })).toEqualTypeOf<
    Promise<{ readonly status: 200; readonly data: AddResponse }>
  >();
});

test("unwrap: false on error-bearing endpoint returns discriminated union", () => {
  const handlers = defineHandlers<DivideContract>()({
    Divide: handle<DivideContract, "Divide">(async ({ body }) => ({
      quotient: body.dividend / body.divisor,
    })),
  });

  const client = createDirectClient<DivideContract>(handlers);

  expectTypeOf(
    client.Divide({ dividend: 10, divisor: 2 }, { unwrap: false }),
  ).toEqualTypeOf<
    Promise<
      | { readonly status: 200; readonly data: DivideResponse }
      | { readonly status: 400; readonly data: { message: string } }
    >
  >();
});

test("unwrap: false on inputless endpoint returns RivetEndpointResult", () => {
  const handlers = defineHandlers<PingContract>()({
    Ping: handle<PingContract, "Ping">(async () => ({
      pong: true as const,
    })),
  });

  const client = createDirectClient<PingContract>(handlers);

  expectTypeOf(client.Ping({ unwrap: false })).toEqualTypeOf<
    Promise<{ readonly status: 200; readonly data: PingResponse }>
  >();
});

test("default unwrap still returns the DTO directly", () => {
  const handlers = defineHandlers<MathContract>()({
    Add: handle<MathContract, "Add">(async ({ body }) => ({
      sum: body.a + body.b,
    })),
  });

  const client = createDirectClient<MathContract>(handlers);

  expectTypeOf(client.Add({ a: 1, b: 2 })).toEqualTypeOf<Promise<AddResponse>>();
});

// -- unwrap: false runtime tests --

test("unwrap: false wraps successful result in envelope", async () => {
  const handlers = defineHandlers<MathContract>()({
    Add: handle<MathContract, "Add">(async ({ body }) => ({
      sum: body.a + body.b,
    })),
  });

  const client = createDirectClient<MathContract>(handlers);
  const result = await client.Add({ a: 5, b: 3 }, { unwrap: false });

  expect(result).toEqual({ status: 200, data: { sum: 8 } });
});

test("unwrap: false catches RivetError and returns error result", async () => {
  const handlers = defineHandlers<DivideContract>()({
    Divide: handle<DivideContract, "Divide">(async ({ body }) => {
      if (body.divisor === 0) {
        throw new RivetError({ status: 400, data: { message: "division by zero" } });
      }
      return { quotient: body.dividend / body.divisor };
    }),
  });

  const client = createDirectClient<DivideContract>(handlers);
  const result = await client.Divide({ dividend: 10, divisor: 0 }, { unwrap: false });

  expect(result).toEqual({ status: 400, data: { message: "division by zero" } });
});

test("default unwrap re-throws RivetError", async () => {
  const handlers = defineHandlers<DivideContract>()({
    Divide: handle<DivideContract, "Divide">(async ({ body }) => {
      if (body.divisor === 0) {
        throw new RivetError({ status: 400, data: { message: "division by zero" } });
      }
      return { quotient: body.dividend / body.divisor };
    }),
  });

  const client = createDirectClient<DivideContract>(handlers);

  await expect(client.Divide({ dividend: 10, divisor: 0 })).rejects.toThrow(RivetError);
});

test("discriminated union narrows correctly by status", async () => {
  const handlers = defineHandlers<DivideContract>()({
    Divide: handle<DivideContract, "Divide">(async ({ body }) => {
      if (body.divisor === 0) {
        throw new RivetError({ status: 400, data: { message: "division by zero" } });
      }
      return { quotient: body.dividend / body.divisor };
    }),
  });

  const client = createDirectClient<DivideContract>(handlers);
  const result = await client.Divide({ dividend: 10, divisor: 0 }, { unwrap: false });

  if (result.status === 400) {
    expectTypeOf(result.data).toEqualTypeOf<{ message: string }>();
    expect(result.data).toEqual({ message: "division by zero" });
  }
});
