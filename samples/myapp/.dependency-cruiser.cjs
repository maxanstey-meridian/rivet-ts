module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies make ownership and dependency direction unclear.",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "no-feature-to-feature",
      severity: "error",
      comment: "Feature modules may depend only on themselves and common.",
      from: {
        path: "^packages/api/src/modules/(?!common/)([^/]+)/.+\\.ts$",
      },
      to: {
        path: "^packages/api/src/modules/.+\\.ts$",
        pathNot: "^packages/api/src/modules/($1|common)/",
      },
    },
    {
      name: "no-common-to-feature",
      severity: "error",
      comment: "Common is shared infrastructure, not a backdoor into feature internals.",
      from: {
        path: "^packages/api/src/modules/common/.+\\.ts$",
      },
      to: {
        path: "^packages/api/src/modules/(?!common/).+\\.ts$",
      },
    },
    {
      name: "no-domain-outside-own-domain",
      severity: "error",
      comment: "Domain stays inside its own local domain boundary.",
      from: {
        path: "^packages/api/src/modules/(?!common/)([^/]+)/domain/.+\\.ts$",
      },
      to: {
        path: "^packages/api/src/.+\\.ts$",
        pathNot: "^packages/api/src/modules/$1/domain/",
      },
    },
    {
      name: "no-application-to-infrastructure",
      severity: "error",
      comment: "Application must not depend on infrastructure.",
      from: {
        path: "^packages/api/src/modules/[^/]+/application/.+\\.ts$",
      },
      to: {
        path: "^packages/api/src/modules/[^/]+/infrastructure/.+\\.ts$",
      },
    },
    {
      name: "no-application-to-interface",
      severity: "error",
      comment: "Application must not depend on transport.",
      from: {
        path: "^packages/api/src/modules/[^/]+/application/.+\\.ts$",
      },
      to: {
        path: "^packages/api/src/modules/[^/]+/interface/.+\\.ts$",
      },
    },
    {
      name: "no-infrastructure-to-interface",
      severity: "error",
      comment: "Infrastructure must not depend on transport.",
      from: {
        path: "^packages/api/src/modules/[^/]+/infrastructure/.+\\.ts$",
      },
      to: {
        path: "^packages/api/src/modules/[^/]+/interface/.+\\.ts$",
      },
    },
    {
      name: "no-handler-to-domain",
      severity: "error",
      comment: "HTTP handlers should go through application, not domain.",
      from: {
        path: "^packages/api/src/modules/[^/]+/interface/http/.+\\.handler\\.ts$",
      },
      to: {
        path: "^packages/api/src/modules/[^/]+/domain/.+\\.ts$",
      },
    },
    {
      name: "no-handler-to-infrastructure",
      severity: "error",
      comment: "HTTP handlers must not depend on infrastructure directly.",
      from: {
        path: "^packages/api/src/modules/[^/]+/interface/http/.+\\.handler\\.ts$",
      },
      to: {
        path: "^packages/api/src/modules/[^/]+/infrastructure/.+\\.ts$",
      },
    },
    {
      name: "no-module-to-app-runtime",
      severity: "error",
      comment: "Composition happens at the app edge, not inside modules.",
      from: {
        path: "^packages/api/src/modules/.+\\.ts$",
      },
      to: {
        path: "^packages/api/src/(app\\.ts|app/.+\\.ts)$",
        pathNot: "^packages/api/src/app/contract\\.ts$",
      },
    },
    {
      name: "no-api-to-client",
      severity: "error",
      comment: "API source must not depend on client artifacts.",
      from: {
        path: "^packages/api/src/.+\\.ts$",
      },
      to: {
        path: "^packages/client/.+\\.(ts|js|json)$",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "^node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
  },
};
