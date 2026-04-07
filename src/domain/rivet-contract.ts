export type RivetPrimitiveTypeName = "boolean" | "File" | "number" | "string" | "unknown";

export type RivetType =
  | {
      kind: "primitive";
      type: RivetPrimitiveTypeName;
      format?: string;
      csharpType?: string;
    }
  | {
      kind: "nullable";
      inner: RivetType;
    }
  | {
      kind: "array";
      element: RivetType;
    }
  | {
      kind: "dictionary";
      value: RivetType;
    }
  | {
      kind: "stringUnion";
      values: readonly string[];
    }
  | {
      kind: "intUnion";
      values: readonly number[];
    }
  | {
      kind: "ref";
      name: string;
    }
  | {
      kind: "generic";
      name: string;
      typeArgs: readonly RivetType[];
    }
  | {
      kind: "typeParam";
      name: string;
    }
  | {
      kind: "brand";
      name: string;
      underlying: RivetType;
    }
  | {
      kind: "inlineObject";
      properties: readonly RivetInlineObjectProperty[];
    };

export type RivetInlineObjectProperty = {
  name: string;
  type: RivetType;
};

export type RivetPropertyDefinition = {
  name: string;
  type: RivetType;
  optional: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
};

export type RivetEndpointExampleValue =
  | string
  | number
  | boolean
  | null
  | readonly RivetEndpointExampleValue[]
  | { readonly [key: string]: RivetEndpointExampleValue };

export class RivetEndpointExample {
  public readonly data: RivetEndpointExampleValue;

  public constructor(input: { data: RivetEndpointExampleValue }) {
    this.data = input.data;
  }
}

export class RivetRequestExample {
  public readonly name?: string;
  public readonly mediaType: string;
  public readonly json?: string;
  public readonly componentExampleId?: string;
  public readonly resolvedJson?: string;

  public constructor(
    input:
      | {
          mediaType: string;
          json: RivetEndpointExampleValue;
          name?: string;
        }
      | {
          mediaType: string;
          componentExampleId: string;
          resolvedJson: RivetEndpointExampleValue;
          name?: string;
        },
  ) {
    if ("json" in input) {
      this.json = JSON.stringify(input.json);
    } else {
      this.componentExampleId = input.componentExampleId;
      this.resolvedJson = JSON.stringify(input.resolvedJson);
    }

    if (input.name !== undefined) {
      this.name = input.name;
    }

    this.mediaType = input.mediaType;
  }
}

export class RivetResponseExample {
  public readonly name?: string;
  public readonly mediaType: string;
  public readonly json?: string;
  public readonly componentExampleId?: string;
  public readonly resolvedJson?: string;

  public constructor(
    input:
      | {
          mediaType: string;
          json: RivetEndpointExampleValue;
          name?: string;
        }
      | {
          mediaType: string;
          componentExampleId: string;
          resolvedJson: RivetEndpointExampleValue;
          name?: string;
        },
  ) {
    if ("json" in input) {
      this.json = JSON.stringify(input.json);
    } else {
      this.componentExampleId = input.componentExampleId;
      this.resolvedJson = JSON.stringify(input.resolvedJson);
    }

    if (input.name !== undefined) {
      this.name = input.name;
    }

    this.mediaType = input.mediaType;
  }
}

export class RivetTypeDefinition {
  public readonly name: string;
  public readonly typeParameters: readonly string[];
  public readonly properties: readonly RivetPropertyDefinition[];
  public readonly description?: string;

  public constructor(input: {
    name: string;
    typeParameters?: readonly string[];
    properties: readonly RivetPropertyDefinition[];
    description?: string;
  }) {
    this.name = input.name;
    this.typeParameters = input.typeParameters ?? [];
    this.properties = input.properties;
    this.description = input.description;
  }
}

export type RivetContractEnum =
  | {
      name: string;
      values: readonly string[];
    }
  | {
      name: string;
      intValues: readonly number[];
    };

export type RivetEndpointParamSource = "body" | "file" | "formField" | "query" | "route";

export class RivetEndpointParam {
  public readonly name: string;
  public readonly type: RivetType;
  public readonly source: RivetEndpointParamSource;

  public constructor(input: { name: string; type: RivetType; source: RivetEndpointParamSource }) {
    this.name = input.name;
    this.type = input.type;
    this.source = input.source;
  }
}

export class RivetResponseType {
  public readonly statusCode: number;
  public readonly dataType?: RivetType;
  public readonly description?: string;
  public readonly examples?: readonly RivetResponseExample[];

  public constructor(input: {
    statusCode: number;
    dataType?: RivetType;
    description?: string;
    examples?: readonly RivetResponseExample[];
  }) {
    this.statusCode = input.statusCode;
    this.dataType = input.dataType;
    this.description = input.description;
    this.examples = input.examples;
  }
}

export class RivetEndpointSecurity {
  public readonly isAnonymous: boolean;
  public readonly scheme?: string;

  public constructor(input: { isAnonymous: boolean; scheme?: string }) {
    this.isAnonymous = input.isAnonymous;
    this.scheme = input.scheme;
  }
}

export class RivetEndpointDefinition {
  public readonly name: string;
  public readonly httpMethod: string;
  public readonly routeTemplate: string;
  public readonly params: readonly RivetEndpointParam[];
  public readonly returnType?: RivetType;
  public readonly controllerName: string;
  public readonly responses: readonly RivetResponseType[];
  public readonly summary?: string;
  public readonly description?: string;
  public readonly requestExamples?: readonly RivetRequestExample[];
  public readonly security?: RivetEndpointSecurity;
  public readonly fileContentType?: string;
  public readonly inputTypeName?: string;
  public readonly isFormEncoded?: boolean;
  public readonly queryAuth?: { parameterName: string };

  public constructor(input: {
    name: string;
    httpMethod: string;
    routeTemplate: string;
    params: readonly RivetEndpointParam[];
    returnType?: RivetType;
    controllerName: string;
    responses: readonly RivetResponseType[];
    summary?: string;
    description?: string;
    requestExamples?: readonly RivetRequestExample[];
    security?: RivetEndpointSecurity;
    fileContentType?: string;
    inputTypeName?: string;
    isFormEncoded?: boolean;
    queryAuth?: { parameterName: string };
  }) {
    this.name = input.name;
    this.httpMethod = input.httpMethod;
    this.routeTemplate = input.routeTemplate;
    this.params = input.params;
    this.returnType = input.returnType;
    this.controllerName = input.controllerName;
    this.responses = input.responses;
    this.summary = input.summary;
    this.description = input.description;
    this.requestExamples = input.requestExamples;
    this.security = input.security;
    this.fileContentType = input.fileContentType;
    this.inputTypeName = input.inputTypeName;
    this.isFormEncoded = input.isFormEncoded;
    this.queryAuth = input.queryAuth;
  }
}

export class RivetContractDocument {
  public readonly types: readonly RivetTypeDefinition[];
  public readonly enums: readonly RivetContractEnum[];
  public readonly endpoints: readonly RivetEndpointDefinition[];

  public constructor(input: {
    types?: readonly RivetTypeDefinition[];
    enums?: readonly RivetContractEnum[];
    endpoints?: readonly RivetEndpointDefinition[];
  }) {
    this.types = input.types ?? [];
    this.enums = input.enums ?? [];
    this.endpoints = input.endpoints ?? [];
  }
}
