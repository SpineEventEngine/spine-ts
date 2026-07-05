# T-0012.11c: Projection List Queries

Status: complete
Start: `2026-07-05 03:04 WEST`
Parent task: `T-0012.11 Missing Details And Example Readiness`
Branch: `task/T-0012-11c-projection-list-queries`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11c-projection-list-queries`
Baseline commit: `8caec30`

## Goal

Expand `QueryService.Read` from ID-only projection reads to the smallest real
projection-state list read needed by the to-do example.

## Must Preserve

- Keep the slice narrow and JVM-familiar.
- Preserve strict write-side/read-side segregation.
- Use generated Spine query/filter contracts directly.
- Preserve existing tenant-boundary behavior for single-tenant and
  multitenant contexts.
- Do not add a broad query DSL, paging engine, sort planner, aggregate query
  support, or read-side facade beyond the minimum projection list read.
- Keep names short and follow the cleanup-era code style rules.

## Required Evidence

- `build-protocol/tasks/T-0012-11-missing-details-example-readiness/TASK.md`
- `build-protocol/tasks/T-0012-11b-projection-event-updates/TASK.md`
- `packages/server/src/services/spine-services.ts`
- `packages/server/src/stand/stand.ts`
- `packages/server/test/services/spine-services.test.ts`
- `packages/storage/src/record/record-storage.ts`
- `packages/storage/src/record/record-query.ts`
- `spine-jvm-docs/spine-client-api-queries-subscriptions-and-tests.md`

## Acceptance Criteria

- `QueryService.Read` supports `Target.include_all`/generated `includeAll`
  projection-state reads.
- Include-all projection reads return versioned `EntityStateWithVersion`
  messages using the same packing shape as ID reads.
- Include-all projection reads preserve tenant-boundary behavior already
  covered by `T-0012.10`, including `TenantId` value, domain, and email
  variants.
- Existing ID-filter query behavior continues to pass.
- Storage errors during include-all reads return the existing sanitized
  `QUERY_READ_ERROR` shape.
- The implementation does not introduce speculative query infrastructure or
  aggregate querying.

## TDD Plan

1. Add focused failing QueryService tests for include-all projection reads,
   version packing, tenant isolation, tenant value/domain/email variants, and
   read failure sanitization.
2. Add focused Stand tests for storage-backed versioned list reads if `Stand`
   needs a new list method.
3. Implement the smallest Stand/service path over `RecordStorage.query()`.
4. Update public/API docs and durable logs.
5. Run focused verification, full verification, and the required review loop.

## Verification Plan

- Focused red test command(s) with expected failure summaries.
- Focused green test command(s).
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm docs:check`
- `pnpm test:coverage`
- `git diff --check`

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Current State

- Implemented on branch `task/T-0012-11c-projection-list-queries` through
  reviewed commit `4102284`.
- `Stand.readAllVersioned()` uses `RecordStorage.query()` directly and reuses
  the point-read version cloning path.
- `QueryService.Read` accepts projection-state `Target.include_all` queries,
  preserves tenant validation for projection routes, rejects non-projection
  include-all targets with `INVALID_QUERY` before tenant validation or storage
  access, and packs versioned responses in the same shape as ID-filter reads.
- Required review lanes have no remaining comments.
- Final verification passed: focused stand and service tests, `pnpm typecheck`,
  `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, `git diff --check`, and
  escalated `pnpm test:coverage` with 45 files and 592 tests.
