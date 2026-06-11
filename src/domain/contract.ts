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
