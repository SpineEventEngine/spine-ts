# T-0017b Review Log

Status: clean

Scope: query execution over read-side columns, query-service routes, `Stand`
query behavior, tenant scoping, docs/API boundary, and verification evidence.

## Required Lanes

| Lane                       | Status  | Result  |
| -------------------------- | ------- | ------- |
| Code style/maintainability | Complete | Clean |
| Documentation completeness | Complete | Clean |
| TypeScript/API docs        | Complete | Clean |
| Security                   | Complete | Clean |
| Performance/reliability    | Complete | Clean |

## Findings

- Documentation: `packages/server/README.md` still says field filtering is
  deferred even though field masks are supported. The TypeDoc-facing
  `SpineServices` comment must also qualify positive limits as requiring
  ordering.
- TypeScript/API: `validateSimpleFilters()` accepts empty or blank column
  names, letting malformed filters reach storage instead of deterministic
  `INVALID_QUERY` rejection.
- Security: Query breadth is uncapped before in-memory scan/sort. Add
  deterministic QueryService caps for ID filters, filters, ordering, field
  masks, path length, and maximum limit.
- Performance/reliability: Query filters and ordering accept arbitrary
  top-level fields instead of repository-declared columns. Carry repository
  column metadata into `StateRoute` and reject non-column filters/orders before
  storage.
- Performance/reliability: `CompositeFilter_CompositeOperator.CCF_CO_UNDEFINED`
  is accepted as `ALL`; reject undefined composite operators for this slice.

## Fix Follow-Up

`2026-07-08 22:51 WEST`: The findings above were fixed in the T-0017b
worktree. `QueryService.Read` now rejects blank/undefined filter columns,
excessive query breadth, undeclared filter/order columns, and undefined
composite operators before Stand storage is read. `StateRoute` carries
repository-declared column names from repository metadata. The package README no
longer describes supported field-mask behavior as deferred, and the
`SpineServices` TypeDoc-facing JSDoc qualifies positive limits as supported only
when at least one ordering directive is present.

Verification after the fixes:

- `pnpm exec vitest run packages/server/test/services/spine-services.test.ts`
  passed outside the sandbox with localhost binding allowed: 1 file, 60 tests.
- `pnpm lint` passed.
- `pnpm format:check` passed.
- `pnpm docs:check` passed with only the existing invalid `origin` TypeDoc
  warning.
- `pnpm proto:check-generated` passed.

## Re-Review Follow-Up

`2026-07-08 23:05 WEST`: Second review round found two remaining issues:

- Documentation needed to state that filter and `order_by` column names are
  declared projection `(column)` proto field names, such as `open_task_count`,
  not generated TS local names such as `openTaskCount`.
- Security review found the simple-filter breadth cap ran after per-filter
  validation. The cap now runs before walking simple filters, and a regression
  verifies excessive invalid filters return the breadth error first.

Verification after these fixes:

- `pnpm exec vitest run packages/server/test/services/spine-services.test.ts`
  passed outside the sandbox with localhost binding allowed: 1 file, 60 tests.
- `pnpm format:check`, `pnpm docs:check`, `pnpm lint`,
  `pnpm proto:check-generated`, and `git diff --check 8dd37ca` passed.
- `pnpm --config.verify-deps-before-run=false verify` passed: 53 test files and
  914 tests passed, global coverage was 95.08% statements / 90.29% branches /
  97.9% functions / 95.05% lines, TypeDoc emitted only the known invalid
  `origin` remote warning, proto lint passed, and generated output was ignored,
  untracked, and freshly regenerated.

`2026-07-08 23:12 WEST`: Final documentation re-review requested two wording
fixes. The `SpineServices` TSDoc now includes the concrete
`open_task_count`/`openTaskCount` naming example and says undeclared columns
return `INVALID_QUERY` before Stand storage. The architecture guide now says
undeclared columns return `INVALID_QUERY` before Stand storage reads.

Final verification:

- Security final re-review returned clean.
- Documentation final re-review findings were fixed.
- `pnpm docs:check`, `pnpm format:check`, and
  `pnpm exec vitest run packages/server/test/services/spine-services.test.ts`
  passed after the final documentation wording fixes.
- Final `pnpm --config.verify-deps-before-run=false verify` passed: 53 test
  files and 914 tests passed, global coverage was 95.08% statements / 90.29%
  branches / 97.9% functions / 95.05% lines, TypeDoc emitted only the known
  invalid `origin` remote warning, proto lint passed, and generated output was
  ignored, untracked, and freshly regenerated.

## Review Policy

- Every formal reviewer lane must be run by a separate sub-agent.
- Findings must be fed back to an authoring/fix sub-agent.
- Re-review continues until all lanes are clean before integration.
- All participating sub-agents must be closed after their result is recorded.
