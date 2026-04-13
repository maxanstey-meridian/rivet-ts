import { expect, expectTypeOf, test } from "vitest";
import type { Contract, Endpoint } from "../../src/domain/authoring-types.js";
import {
  RivetError,
  type RivetEndpointResult,
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

test("RivetError extends Error and stores result", () => {
  const error = new RivetError({ status: 400, data: { message: "bad" } });

  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(RivetError);
  expect(error.message).toBe("RivetError");
  expect(error.result.status).toBe(400);
  expect(error.result.data).toEqual({ message: "bad" });
});
