import { TypeExpression } from "./type-expression.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type EndpointExampleValue =
  | string
  | number
  | boolean
  | null
  | readonly EndpointExampleValue[]
  | { readonly [key: string]: EndpointExampleValue };

export class EndpointExampleSpec {
  public readonly data?: EndpointExampleValue;
  public readonly name?: string;
  public readonly mediaType?: string;
  public readonly componentExampleId?: string;
  public readonly resolvedJson?: EndpointExampleValue;

  public constructor(
    input:
      | {
          data: EndpointExampleValue;
          name?: string;
          mediaType?: string;
        }
      | {
          componentExampleId: string;
          resolvedJson: EndpointExampleValue;
          name?: string;
          mediaType?: string;
        },
  ) {
    if ("data" in input) {
      this.data = input.data;
    } else {
      this.componentExampleId = input.componentExampleId;
      this.resolvedJson = input.resolvedJson;
    }

    if (input.name !== undefined) {
      this.name = input.name;
    }

    if (input.mediaType !== undefined) {
      this.mediaType = input.mediaType;
    }
  }
}

export class ResponseExamplesSpec {
  public readonly status: number;
  public readonly examples: readonly EndpointExampleSpec[];

  public constructor(input: { status: number; examples: readonly EndpointExampleSpec[] }) {
    this.status = input.status;
    this.examples = input.examples;
  }
}

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
  public readonly formEncoded: boolean;
  public readonly acceptsFile: boolean;
  public readonly successStatus?: number;
  public readonly summary?: string;
  public readonly description?: string;
  public readonly requestExamples: readonly EndpointExampleSpec[];
  public readonly responseExamples: readonly ResponseExamplesSpec[];
  public readonly errors: readonly ErrorResponseSpec[];
  public readonly anonymous: boolean;
  public readonly security?: SecuritySpec;
  public readonly queryAuth?: string;

  public constructor(input: {
    name: string;
    method: HttpMethod;
    route: string;
    input?: TypeExpression;
    response?: TypeExpression;
    fileResponse?: boolean;
    fileContentType?: string;
    formEncoded?: boolean;
    acceptsFile?: boolean;
    successStatus?: number;
    summary?: string;
    description?: string;
    requestExamples?: readonly EndpointExampleSpec[];
    responseExamples?: readonly ResponseExamplesSpec[];
    errors?: readonly ErrorResponseSpec[];
    anonymous?: boolean;
    security?: SecuritySpec;
    queryAuth?: string;
  }) {
    this.name = input.name;
    this.method = input.method;
    this.route = input.route;
    this.input = input.input;
    this.response = input.response;
    this.fileResponse = input.fileResponse ?? false;
    this.fileContentType = input.fileContentType;
    this.formEncoded = input.formEncoded ?? false;
    this.acceptsFile = input.acceptsFile ?? false;
    this.successStatus = input.successStatus;
    this.summary = input.summary;
    this.description = input.description;
    this.requestExamples = input.requestExamples ?? [];
    this.responseExamples = input.responseExamples ?? [];
    this.errors = input.errors ?? [];
    this.anonymous = input.anonymous ?? false;
    this.security = input.security;
    this.queryAuth = input.queryAuth;
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
