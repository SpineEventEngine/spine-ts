# T-0017b Implementation Report

Date: `2026-07-08`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0017b-query-execution`
Branch: `task/T-0017b-query-execution`

## Decisions

- Added `Stand.queryVersioned(schema, query, options?)` as the small Stand query
  path over storage `RecordQuery`.
- Implemented service-side conversion from supported `Query` proto fields to
  storage query options inside `SpineServices`, without adding a public client
  query DSL.
- Kept support intentionally narrow: ID filters, projection `include_all`,
  top-level projection `EQUAL` column filters, field masks, repeated ordering,
  and positive limits when ordering is present.
- Kept invalid or unsupported query shapes as deterministic `QueryResponse`
  errors: unsupported targets, false/missing criteria, non-projection
  `include_all`, non-projection column filters, nested composites, `EITHER`,
  non-`EQUAL` operators, empty order columns, unsupported order directions, and
  limit without ordering.
- Used `RecordStorage.queryEntries()` in `Stand.queryVersioned()` so version
  metadata can be found by storage slot ID even when a response mask omits the
  entity ID field.
- Preserved Protobuf-ES `$typeName` during storage mask pruning so masked
  generated messages remain cloneable/packable.

## Changed Files

- `packages/server/src/stand/stand.ts`
- `packages/server/src/services/spine-services.ts`
- `packages/storage/src/record/record-mask.ts`
- `packages/server/test/services/spine-services.test.ts`
- `packages/server/test/stand/stand.test.ts`
- `packages/storage/test/memory/in-memory-record-storage.test.ts`
- `examples/todo/src/index.test.ts`
- `packages/server/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `docs/api/README.md`
- `build-protocol/work-logs/T-0017b.md`
- `build-protocol/tasks/T-0017b-query-execution/IMPLEMENTATION_REPORT.md`
- `build-protocol/reviews/T-0017a-read-side-catch-up.md`

## Verification Evidence

- Initial full verification found the stale todo example assertion that
  projection column filters were unsupported. That example test now verifies
  filtering task-list projections by declared proto column `open_task_count`,
  matching T-0017b.
- `pnpm exec vitest run examples/todo/src/index.test.ts` passed outside the
  sandbox with localhost binding allowed: 1 test file, 20 tests. The same
  command inside the sandbox failed only because the standalone gRPC example
  test could not bind `127.0.0.1` (`listen EPERM`).
- `pnpm exec vitest run packages/server/test/services/spine-services.test.ts packages/server/test/stand/stand.test.ts packages/storage/test/memory/in-memory-record-storage.test.ts`
  passed outside the sandbox with localhost binding allowed: 3 test files, 88
  tests.
- After the global branch threshold miss, added focused tests in
  `packages/server/test/services/spine-services.test.ts`,
  `packages/server/test/stand/stand.test.ts`, and
  `packages/storage/test/memory/in-memory-record-storage.test.ts` to cover
  malformed query ordering/ID conversion, no-ID Stand schema registration, and
  blank storage mask paths.
- `pnpm exec vitest run packages/server/test/services/spine-services.test.ts packages/server/test/stand/stand.test.ts packages/storage/test/memory/in-memory-record-storage.test.ts`
  passed outside the sandbox with localhost binding allowed: 3 test files, 92
  tests. The same command inside the sandbox failed only because gRPC transport
  tests could not bind `127.0.0.1` (`listen EPERM`).
- `pnpm test:coverage:generated` passed outside the sandbox with local
  transport permissions: 53 test files, 910 tests, global branch coverage 90.19%
  (2170/2406), above the 90% threshold. The same command inside the sandbox
  failed only on local server/IPC permission errors (`listen EPERM` /
  `Operation not permitted`).
- `pnpm format:check` passed: all matched files use Prettier code style.
- `pnpm --config.verify-deps-before-run=false verify` passed after the final
  test fixes: 53 test files and 910 tests passed, global coverage was 95.03%
  statements / 90.19% branches / 97.81% functions / 95.01% lines, TypeDoc
  emitted only the known invalid `origin` remote warning, proto lint passed,
  and generated output was ignored, untracked, and freshly regenerated.
- `pnpm --config.verify-deps-before-run=false verify` passed after formal-review
  fixes and the Stand column handoff: 53 test files and 914 tests passed, global
  coverage was 95.08% statements / 90.29% branches / 97.9% functions / 95.05%
  lines, TypeDoc emitted only the known invalid `origin` remote warning, proto
  lint passed, and generated output was ignored, untracked, and freshly
  regenerated.
- Final `pnpm --config.verify-deps-before-run=false verify` passed after the
  second/final re-review fixes: 53 test files and 914 tests passed, global
  coverage was 95.08% statements / 90.29% branches / 97.9% functions / 95.05%
  lines, TypeDoc emitted only the known invalid `origin` remote warning, proto
  lint passed, and generated output was ignored, untracked, and freshly
  regenerated. All reviewer lanes reached clean status.
- `pnpm lint` passed.
- `pnpm docs:check` passed. TypeDoc emitted the existing invalid `origin` remote
  warning and no errors.
- `pnpm proto:check-generated` passed.
- `git diff --check` passed.
- `build-protocol/reviews/T-0017a-read-side-catch-up.md` was formatted with
  Prettier to remove the global format-check blocker inherited from the
  already-merged T-0017a review log.

## Concerns

- None remaining for T-0017b.
