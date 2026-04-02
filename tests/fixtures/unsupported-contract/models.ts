export type ConditionalDto<TValue> = TValue extends string ? { value: TValue } : never;

export type MappedDto<TValue> = {
  [TKey in keyof TValue]: string;
};

export interface InlineOptionalWrapper {
  nested: {
    required: string;
    optional?: string;
  };
}

export interface IntersectionWrapper {
  value: string & { readonly __tag: "Value" };
}

export interface BadSearchQuery {
  teamId: string;
  filters: MappedDto<{
    status: string;
    role: string;
  }>;
}
