# T-0016b Implementation Report

Status: implemented; round 1 fixes applied

## Changed Files

- `packages/server/src/context/bounded-context.ts`
- `packages/server/test/context/bounded-context.test.ts`
- `examples/todo/src/index.ts`
- `examples/todo/src/index.test.ts`
- `scripts/check-cleanup-rules.mjs`
- `scripts/check-cleanup-rules.test.mjs`
- `packages/server/README.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `build-protocol/DEVELOPER_API.md`
- `examples/todo/README.md`
- `examples/todo/USER_GUIDE.md`
- `build-protocol/tasks/T-0016b-framework-owned-assembly/TASK.md`

Pre-existing branch task/review docs and D-0060 decision-log changes were kept
and included in the branch state.

## Design Notes

- `BoundedContextBuilder.add()` now accepts either a `Repository` instance or an
  entity class.
- Synchronous `build()` keeps explicit repository behavior and fails clearly if
  entity classes are queued, telling callers to use `buildAsync()`.
- `buildAsync()` loads the conventional generated registry module from
  `process.cwd()` by default, with `withGeneratedRegistryRoot(root)` for package
  roots such as the to-do example's compiled `dist/` directory.
- Generated registry loading and metadata ingestion stay framework-owned through
  `GeneratedRegistryDiscovery`, `HandlerRegistryIngestor`, and
  `HandlerMetadataRegistry`.
- Default repository construction matches generated records by entity class,
  uses the generated state schema and ingested metadata, and passes aggregate
  command-assignee emitted schemas from generated records into `Repository`.
- Registry dynamic-import retry cache busting moved from the to-do app helper
  into the builder path, preserving recovery after an initial missing generated
  module.
- The to-do example now assembles with entity classes and no longer imports or
  calls registry discovery, handler metadata registries, repository
  constructors, or local metadata helper functions for context assembly.
- Cleanup guards now reject `HandlerMetadataRegistry`,
  `EntityHandlersMetadata`, `GeneratedRegistryDiscovery`, and related generated
  registry/materialization internals in example source, including type-only
  named imports.

## Verification

- `corepack pnpm vitest run packages/server/test/context/bounded-context.test.ts scripts/check-cleanup-rules.test.mjs`
  - Passed: 2 files, 119 tests.
- `corepack pnpm vitest run examples/todo/src/index.test.ts`
  - Sandboxed run failed only on `listen EPERM: operation not permitted
127.0.0.1`.
  - Escalated rerun passed: 1 file, 18 tests.
- `corepack pnpm typecheck`
  - Passed.
- `corepack pnpm test`
  - Sandboxed run failed only on local HTTP/2 listener and ZeroMQ IPC sandbox
    permission errors.
  - Escalated rerun passed: 50 files, 825 tests.
- `corepack pnpm docs:check`
  - Passed with the existing TypeDoc invalid `origin` warning.
- `git diff --check`
  - Passed.
- `git status --short`
  - Checked before report creation; only intended modified/untracked task files
    were present.

## Concerns

- Full tests require escalation in this environment for local HTTP/2 and ZeroMQ
  IPC binding.
- Generated output was regenerated for verification and remains ignored.

## Round 1 Review Fix

Status: fixed; integration result pending

Commit metadata:

- Branch: `task/T-0016b-framework-owned-assembly`
- Commit message: `Fix generated registry assembly review findings`

Fix notes:

- Replaced the public `GeneratedRegistryRoot` method parameter with the simpler
  `string | URL` surface.
- Removed implicit `process.cwd()` registry loading for entity-class assembly.
  `buildAsync()` now requires `withGeneratedRegistryRoot(root)` when entity
  classes are queued.
- Canonicalized trusted generated-registry roots and final registry module
  paths with realpaths, rejected final registry modules that escape the trusted
  root through symlinks, and checked the registry file is readable before every
  dynamic import.
- Added regression coverage for missing explicit roots, symlink escape
  rejection, and deleted-registry freshness before Node ESM cache reuse.
- Extended cleanup guardrails and tests to catch string-literal element access
  such as `server["GeneratedRegistryDiscovery"]`.
- Updated package, user-guide, API, developer, and to-do example docs to show
  explicit `withGeneratedRegistryRoot(compiledPackageRoot).buildAsync()` for
  generated entity-class assembly and synchronous `build()` for explicit
  repository assembly.

Verification:

- `corepack pnpm vitest run packages/server/test/context/bounded-context.test.ts scripts/check-cleanup-rules.test.mjs`
  - Passed: 2 files, 123 tests.
- `corepack pnpm vitest run examples/todo/src/index.test.ts`
  - Sandboxed run failed only on `listen EPERM: operation not permitted
    127.0.0.1`.
  - Escalated rerun passed: 1 file, 18 tests.
- `corepack pnpm typecheck`
  - Passed.
- `corepack pnpm docs:check`
  - Passed with the existing TypeDoc invalid `origin` warning.
- `corepack pnpm test`
  - Sandboxed run failed only on local HTTP/2 listener and ZeroMQ IPC sandbox
    permission errors.
  - Escalated rerun passed: 50 files, 829 tests.
