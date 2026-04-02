import { TypeExpression } from "./type-expression.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export class ErrorResponseSpec {
  public readonly status: number;
  public readonly response?: TypeExpression;
  public readonly description?: string;

  public constructor(input: { status: number; response?: TypeExpression; description?: string }) {
    this.status = input.status;
    this.response = input.response;
    this.description = input.description;
  }
}

export class SecuritySpec {
  public readonly scheme: string;

  public constructor(input: { scheme: string }) {
    this.scheme = input.scheme;
  }
}

export class EndpointSpec {
  public readonly name: string;
  public readonly method: HttpMethod;
  public readonly route: string;
  public readonly input?: TypeExpression;
  public readonly response?: TypeExpression;
  public readonly fileResponse: boolean;
  public readonly fileContentType?: string;
  public readonly successStatus?: number;
  public readonly summary?: string;
  public readonly description?: string;
  public readonly errors: readonly ErrorResponseSpec[];
  public readonly anonymous: boolean;
  public readonly security?: SecuritySpec;

  public constructor(input: {
    name: string;
    method: HttpMethod;
    route: string;
    input?: TypeExpression;
    response?: TypeExpression;
    fileResponse?: boolean;
    fileContentType?: string;
    successStatus?: number;
    summary?: string;
    description?: string;
    errors?: readonly ErrorResponseSpec[];
    anonymous?: boolean;
    security?: SecuritySpec;
  }) {
    this.name = input.name;
    this.method = input.method;
    this.route = input.route;
    this.input = input.input;
    this.response = input.response;
    this.fileResponse = input.fileResponse ?? false;
    this.fileContentType = input.fileContentType;
    this.successStatus = input.successStatus;
    this.summary = input.summary;
    this.description = input.description;
    this.errors = input.errors ?? [];
    this.anonymous = input.anonymous ?? false;
    this.security = input.security;
  }
}

export class ContractSpec {
  public readonly name: string;
  public readonly sourceFilePath: string;
  public readonly endpoints: readonly EndpointSpec[];

  public constructor(input: {
    name: string;
    sourceFilePath: string;
    endpoints: readonly EndpointSpec[];
  }) {
    this.name = input.name;
    this.sourceFilePath = input.sourceFilePath;
    this.endpoints = input.endpoints;
  }
}
