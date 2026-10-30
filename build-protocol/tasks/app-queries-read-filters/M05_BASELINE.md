# M05/M06 generated metadata preparation map

Read-only scan at worktree HEAD `cc19b416d` in
`/Users/armiol/.codex/worktrees/app-queries-read-filters/spine-ts`. Assignment:
source-scanning function, explicit configured profile `gpt-6-luna` / `low`.
Runtime self-introspection is unavailable. No build, generation, tests, source
changes, package/network operations, or descendants were used.

The binding contract is in `TASK.md:19-27`; M05/M06 scope and gates are in
`MILESTONES.md:195-248`. Proposal sections `PROPOSAL.md:96-159` define passive
metadata, static dependency discovery, and the browser/server boundary;
`:161-228` define supported package layouts; `:230-234` requires migration of
existing file/API consumers and removal of stale generated output.

## Current generation and loading path

- `packages/proto-tools/src/generation/build-time-handler-analyzer.ts:315-369`
  exposes `BuildHandlerAnalyzer.analyze(program, sourceFiles)` and returns
  receiver descriptions plus diagnostics. It inspects the application TS
  program/source; it does not instantiate the described classes.
- `packages/proto-tools/src/generation/generated-registry-writer.ts:140-195`
  renders and writes generated registry source. `:153-169` emits the registry
  export; `:242-275` collects static class/schema imports; `:289-327` renders
  receiver/handler descriptions. The generated file currently imports
  `GeneratedHandlerRegistry` as a type from
  `@spine-event-engine/server/spi/handler-registry` and imports actual handler
  classes and schema symbols as values. This is a server application artifact.
- `packages/proto-tools/src/generation/handler-codegen.ts:87-114`
  `generateHandlerRegistry()` places output at
  `<appRoot>/generated/handler/generated-handler-registry.ts`, analyzes source,
  then writes. `scripts/generate-handler-registry.mjs:13-47,138-175` is the CLI
  adapter: transpiles the build-time analyzer/writer into a temp directory,
  analyzes, and calls the writer with staged and published output paths.
- `scripts/proto-workflow.mjs:49-108` declares every atomic model/fixture
  generation target and which targets get an application handler-registry
  post-step. The Message Board handler output is deliberately in the separate
  app package (`:102-107`). `:1320-1344` supplies generated and published
  output paths to the CLI. The workflow publishes whole staged generated trees
  atomically; replacing the tree is how old generated files disappear.
  Message Board has a separate model-registry composition stage at
  `:1458-1504`; that `src/model-registry.ts` output is distinct from the handler
  registry and is not the generated file being renamed.
- `scripts/check-generated-clean.mjs:173-220` compares current and staged
  generated trees. It also has a dedicated Message Board registry freshness
  check (`:187-209`) and uses the workflow's target inventory. Preserve these
  freshness/atomicity checks when the generated output name and shape change.
- `packages/server/src/handler/generated-registry-discovery.ts:18-25,106-214`
  loads modules from explicit paths, expects `generatedHandlerRegistry`, and
  ingests through `HandlerRegistryIngestor`; it performs fail-closed import and
  ingestion validation. `packages/server/src/context/bounded-context.ts:2584-2593`
  stores `withGeneratedRegistryRoot`; `:3001-3035` loads/ingests the registry
  while assembling explicitly selected entities/standalone handlers;
  `:3814` supplies the missing-root diagnostic. `:100` and `:530` also import
  runtime registry types/file constants.
- Distinguish the generated application file from
  `packages/server/src/handler/generated-handler-registry.ts`, a hand-written
  server runtime module containing the current registry data contract and
  `HandlerRegistryIngestor`, and from the public type-only facade
  `packages/server/src/spi/handler-registry.ts`. The current generator imports
  the facade. Migrate/retain the ingestion and validation behavior; a filename
  search alone must not delete this runtime implementation or useful explicit
  registry APIs.

## Model metadata registration already exists

`packages/proto-tools/src/generation/generator.ts:705-744` implements
`ProtoGeneration.compose()`, producing a `TypeRegistry` from configured model
packages. `:810-880` resolves exported Proto manifests and source files through
package exports. `:1041-1114` rewrites dependency imports and emits a generated
`proto-module.ts`; `:1074-1154` shows the static schema/dependency imports and
runtime `registerProtoModule(...)` call. This output is separate from the
server handler description module.

`packages/proto/src/codegen/proto-module-inventory.ts:20-81` registers each
ProtoModule plus its declared dependencies, checks duplicate module/schema and
descriptor conflicts, and exposes the inventory. `packages/core/src/index.ts:1780-1809`
composes its `GeneratedDescriptors` from those registered modules for Any
validation and type lookup. This is the existing general Proto inventory to
extend/use for metadata model schemas; avoid a parallel type registry or a
second AnyPacker/StringifierRegistry route.

`packages/proto-tools/src/model/model-graph.ts:101-124,142-247` resolves only
configured direct model packages, then follows the manifest's dependency graph
in deterministic order and checks version/path conflicts. It resolves package
exports without importing their modules. `generator.ts:711-744` currently
filters registry composition to explicitly configured model packages. M06's
runtime dependency walk must add the separately specified conventional `./spine`
metadata participant behavior without changing Proto source ownership or
requiring dependency execution. The existing graph is a nearby resolution seam,
not proof that runtime package metadata is currently discovered.

The generated Proto modules use static imports of schema modules and declared
Proto modules. The generated handler registry uses static imports of server
handler classes and schema modules. Keep handler imports on the Node/server
metadata path. The proposal explicitly keeps client-facing schema/Q/R exports
separate from handler classes and server bootstrap (`PROPOSAL.md:91-94,151-159`);
M06's generated static bootstrap imports are server/application startup effects,
not browser exports.

## Consumer, export, and packaging inventory

The direct source/API consumers of `withGeneratedRegistryRoot` and/or generated
registry output include:

- Server runtime: `packages/server/src/context/bounded-context.ts`,
  `packages/server/src/handler/generated-registry-discovery.ts`,
  `packages/server/src/handler/generated-handler-registry.ts`,
  `packages/server/src/runtime/standalone-handler-runtime.ts`,
  `packages/server/src/index.ts`, and `packages/server/src/spi/handler-registry.ts`.
- Proto tooling: `packages/proto-tools/src/generation/handler-codegen.ts`,
  `generated-registry-writer.ts`, `generated-source-policy.ts`,
  `scripts/generate-handler-registry.mjs`, `scripts/proto-workflow.mjs`,
  `scripts/check-generated-clean.mjs`, and
  `scripts/normalize-generated-declarations.mjs`. The normalize regex currently
  treats `generated-handler-registry.d.ts` as generated (`:33`); source-policy
  treats the `.ts` basename as generated (`packages/proto-tools/src/generation/generated-source-policy.ts:105`).
- Runtime examples: `examples/todo/src/todo-app.ts`,
  `examples/projects/src/index.ts`, `examples/orders/src/{index.ts,cross-context.ts,query-routing.ts}`,
  `examples/support/src/index.ts`,
  `examples/release-notes/src/domain/index.ts`, and
  `examples/message-board/app/src/index.ts`. The current example docs that name
  the output/API include `examples/todo/USER_GUIDE.md`,
  `examples/message-board/app/REFERENCE.md`, `examples/support/REFERENCE.md`,
  `packages/server/README.md`, and `packages/server/REFERENCE.md`.
- Tests and fixtures: `packages/proto-tools/test/{build-time-handler-analyzer,generated-registry-writer,handler-codegen,handler-tooling-boundary,proto-tools}.test.ts`; `packages/server/test/context/bounded-context.test.ts`,
  `packages/server/test/handler/{generated-handler-registry,generated-registry-discovery,external-origin}.test.ts`,
  plus Server environment/runtime/integration tests. Related black-box fixtures
  include `packages/server-blackbox-tests/test/support-reply-agent.test.ts` and
  `test/agent-recovery/recovery-child.mjs`, and test registry fixture builders in
  `packages/server/test/server/generated-server-registry-fixture.ts` and
  `packages/delivery-client/test-fixtures/{managed-project-context,managed-external-events-application}.mjs`.
  Several other server tests import `handler-registry/{commands,events,rejections,states}_pb.js`;
  those are Proto fixture filenames and are not the generated application
  metadata output.
- Generated outputs/publication: `scripts/proto-workflow.mjs` target metadata and
  `scripts/check-generated-clean.mjs` staging/freshness checks above;
  `scripts/normalize-generated-declarations.mjs` declaration handling;
  `examples/release-notes/scripts/build-main-source.mjs:21-35` explicitly
  bundles the current generated registry as a Node entry point; and
  `examples/message-board/deploy/container/image-contract.test.mjs:135-148`
  checks the app image contains the compiled generated registry. Update all
  those output paths when renaming. The container test also separately checks
  `src/model-registry.js`, which remains a different artifact.

`packages/server/package.json:16-36` currently exposes root, browser, testing,
`./spi/handler-registry`, and delivery entry points; `files: ["dist", ...]` is
at `:38-42`. `packages/proto-tools/package.json:25-42` similarly publishes
`dist` and tooling entry points. M06's `<package>/spine` export is a new package
contract for participating app/model metadata and must resolve to the compiled
metadata file plus declarations, without making browser exports depend on
server implementations. The existing type-only
`@spine-event-engine/server/spi/handler-registry` export is used by generated
code and by external registries; keep it if still needed for explicit registry
construction.

One search caveat: occurrences of the basename include paths to the runtime
server implementation, old generated fixtures created ad hoc in tests, writer
unit-test expected strings, docs, and a handful of unrelated Proto fixture
folder names. Classify each before migration; only generated app metadata output
and the root-discovery API are removed by M05.

## Minimal focused verification paths for implementation

M05's acceptance set is best covered by these existing tests/checks:

```sh
pnpm exec vitest run packages/proto-tools/test/build-time-handler-analyzer.test.ts packages/proto-tools/test/generated-registry-writer.test.ts packages/proto-tools/test/handler-codegen.test.ts packages/proto-tools/test/proto-tools.test.ts packages/server/test/context/bounded-context.test.ts packages/server/test/handler/generated-registry-discovery.test.ts packages/server/test/handler/generated-handler-registry.test.ts --maxWorkers=1
```

Then run the deterministic generated freshness checks and relevant target tests:
`pnpm proto:check-generated` (after generation is intentionally invoked by the
implementer), `pnpm exec vitest run scripts/proto-workflow.test.mjs scripts/normalize-generated-declarations.test.mjs packages/proto-tools/test/handler-tooling-boundary.test.ts examples/message-board/deploy/container/image-contract.test.mjs --maxWorkers=1`.
For M06, add `packages/proto-tools/test/external-consumer.test.ts`, package
metadata/export tests (`scripts/package-metadata.test.mjs`), and a packed app
consumer/bundle proof that exercises transitive/diamond discovery and verifies
published JS/declarations. The container integration is expensive and should be
left to the appropriate release verification unless specifically needed by an
acceptance item.

No source or generated file was changed for this inventory.
