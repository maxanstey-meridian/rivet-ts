import type { RivetContractDocument } from "../../domain/rivet-contract.js";
import {
  assertOutDirWritable,
  emitWorkspace,
  readTemplateTree,
  templatePath,
  toPackageScope,
} from "./workspace-emitter.js";

/**
 * Contract-less scaffold (`rivet-ts scaffold`): the golden-shape workspace
 * with two worked example modules mirroring `~/Sites/golden`'s idiom, copied
 * from `templates/example`:
 *
 * - `quotes` — typed-inject class use cases, abstract-class ports, TWO
 *   adapters per port story: in-memory (server entry) and Dexie (browser
 *   entry — versioned schema = migrations, populate = seed), domain error
 *   mapped to the contract's declared 409, Zod edge validation shared with
 *   the ui's UForm.
 * - `users` — a `current-user` port with a stub adapter behind GET /api/me,
 *   making the example multi-module (two contract groups registered).
 *
 * Composition is split per environment: `local.ts` (browser) wires Dexie,
 * `main.ts` (server) wires in-memory + logger + cors. This is what
 * `plumb init --ts-backend` calls.
 */

/** The example contract entry; the CLI lowers it to produce the bootstrap contract. */
export const EXAMPLE_CONTRACTS_PATH = templatePath("example", "apps", "api", "src", "contracts.ts");

export type ExampleProjectConfig = {
  readonly outDir: string;
  readonly projectName: string;
  readonly force: boolean;
  readonly document: RivetContractDocument;
};

/**
 * Emits the workspace skeleton plus the worked example modules. The caller
 * lowers EXAMPLE_CONTRACTS_PATH and provides the document — the same pipeline
 * real projects run, so the bootstrap artifacts can never drift from what the
 * entry actually declares.
 */
export const emitExampleProject = async (config: ExampleProjectConfig): Promise<void> => {
  await assertOutDirWritable(config.outDir, config.force);

  await emitWorkspace(
    {
      outDir: config.outDir,
      projectName: config.projectName,
      variant: "full",
      document: config.document,
      contractEntryRelativePath: "contracts.ts",
      extraApiDependencies: ["dexie", "typed-inject"],
    },
    {
      ...(await readTemplateTree("shared")),
      ...(await readTemplateTree("example", {
        __PACKAGE_SCOPE__: toPackageScope(config.projectName),
      })),
    },
  );
};

export type FrontendProjectConfig = {
  readonly outDir: string;
  readonly projectName: string;
  readonly force: boolean;
};

/**
 * Frontend-only scaffold (`rivet-ts scaffold --no-api`): Nuxt ui + contracts
 * package, no api app — for repos whose API lives elsewhere (a .NET backend,
 * a separate repo). The bootstrap spec is an empty-but-valid document; `task
 * generate`'s first command is a TODO pointing at the real API's emitter.
 */
export const emitFrontendOnlyProject = async (config: FrontendProjectConfig): Promise<void> => {
  await assertOutDirWritable(config.outDir, config.force);
  await emitWorkspace(
    { outDir: config.outDir, projectName: config.projectName, variant: "frontend-only" },
    {},
  );
};
