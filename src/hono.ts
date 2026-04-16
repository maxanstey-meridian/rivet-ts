import { Hono } from "hono";
import type { ContractEndpointKey, RivetHandler } from "./domain/handler-types.js";

type ContractEndpointParamJson = {
  readonly name: string;
  readonly source: string;
};

type ContractEndpointJson = {
  readonly name: string;
  readonly httpMethod: string;
  readonly routeTemplate: string;
  readonly params: ReadonlyArray<ContractEndpointParamJson>;
  readonly responses: ReadonlyArray<{ readonly statusCode: number }>;
};

type ContractJson = {
  readonly endpoints: ReadonlyArray<ContractEndpointJson>;
};

type HandlerMap<TContract> = {
  readonly [TKey in ContractEndpointKey<TContract>]: RivetHandler<TContract, TKey>;
};

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

const toHonoRoute = (routeTemplate: string): string =>
  routeTemplate.replace(/\{([^}]+)\}/g, ":$1");

export const mount = <TContract>(
  contract: ContractJson,
  handlers: HandlerMap<TContract>,
): Hono => {
  const app = new Hono();

  for (const endpoint of contract.endpoints) {
    const handler = handlers[endpoint.name as ContractEndpointKey<TContract>];

    if (!handler) {
      continue;
    }

    const method = endpoint.httpMethod.toLowerCase() as HttpMethod;
    const status = endpoint.responses[0]?.statusCode ?? 200;

    const bodyParam = endpoint.params.find((p) => p.source === "body");
    const routeParams = endpoint.params.filter((p) => p.source === "route");
    const queryParams = endpoint.params.filter((p) => p.source === "query");
    const honoRoute = toHonoRoute(endpoint.routeTemplate);

    app[method](honoRoute, async (c) => {
      const input: Record<string, unknown> = {};

      if (bodyParam) {
        input.body = await c.req.json();
      }
      if (routeParams.length > 0) {
        input.params = c.req.param();
      }
      if (queryParams.length > 0) {
        const query: Record<string, string | undefined> = {};
        for (const p of queryParams) {
          query[p.name] = c.req.query(p.name);
        }
        input.query = query;
      }

      const result = Object.keys(input).length > 0
        ? await (handler as (input: unknown) => Promise<unknown>)(input)
        : await (handler as () => Promise<unknown>)();

      return c.json(result as object, status as 200);
    });
  }

  return app;
};
