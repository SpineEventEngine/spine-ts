# Implementation Report: T-0012.11c Projection List Queries

Status: complete
Branch: `task/T-0012-11c-projection-list-queries`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11c-projection-list-queries`
Baseline commit: `8caec30`

## Summary

This slice adds the smallest read-side list query path needed by the to-do
example: projection-state `include_all` reads through `QueryService.Read`.

Review-fix follow-up from `13b1244` tightened the documentation and the direct
stand reliability evidence without broadening the runtime surface. This
docs-only follow-up clarifies that the same tenant rules apply to direct stand
list reads and `QueryService.Read` include-all projection reads as to point
reads.

## Initial Evidence

- `QueryService.Read` currently requires an ID filter and returns
  `INVALID_QUERY` for `include_all`.
- `Stand` owns read-side storage and version metadata, but currently exposes
  only point reads.
- `RecordStorage.query()` already supports a simple all-record read in
  deterministic storage order and respects tenant-specific storage contexts.

## Implementation

Implemented the smallest storage-backed include-all path:

- `Stand.readAllVersioned(schema, options)` now opens the same record storage
  as point reads, calls `RecordStorage.query()`, and reuses the existing
  version lookup/cloning behavior for each returned state.
- `SpineServices.#read()` now accepts `Target.include_all = true` for
  projection-state queries, rejects non-projection include-all targets,
  validates tenant constraints before execution, and packs each result as
  `EntityStateWithVersion` with the same `Any` + `Version` shape used by
  ID-filter reads.
- ID-filter reads continue through the existing `readVersioned()` path.
- Include-all read failures return the existing sanitized
  `QUERY_READ_ERROR` response.
- README and task logs were updated to document the new list-read behavior and
  the verification evidence.
- Final doc cleanup aligned the package README, architecture notes, and user
  guide so point reads, list reads, and `Target.include_all` summaries all
  state the same single-tenant/multitenant tenant rules.

### RED evidence

- `pnpm exec vitest run packages/server/test/stand/stand.test.ts -t "reads all stored entity states with their versions in storage order"`
  fails with `TypeError: stand.readAllVersioned is not a function` at
  `packages/server/test/stand/stand.test.ts:144`.
- `pnpm exec vitest run packages/server/test/services/spine-services.test.ts -t "reads all projection states through QueryService include-all queries|keeps QueryService include-all reads isolated by tenant|returns stable errors for include-all read failures|treats include-all query tenant domain and email variants as present"`
  fails in four places:
  - include-all reads return response status `error` instead of `ok`;
  - include-all tenant-isolated reads return response status `error` instead of `ok`;
  - include-all read failures surface `QueryService.Read requires an ID filter.`
    instead of the sanitized `Query read failed.`;
  - include-all tenant domain/email handling still fails on the ID-filter guard
    before tenant validation.
- One attempted focused gRPC red run was blocked by the sandbox with
  `Error: listen EPERM: operation not permitted 127.0.0.1`. Direct handler
  query tests were added so the include-all behavior can still be exercised in
  sandboxed runs.

## Verification

- Focused RED:
  - `pnpm exec vitest run packages/server/test/stand/stand.test.ts -t "reads all stored entity states with their versions in storage order"`
  - `pnpm exec vitest run packages/server/test/services/spine-services.test.ts -t "reads all projection states through QueryService include-all queries|keeps QueryService include-all reads isolated by tenant|returns stable errors for include-all read failures|treats include-all query tenant domain and email variants as present"`
- Focused GREEN:
  - `pnpm exec vitest run packages/server/test/stand/stand.test.ts -t "reads all stored entity states with their versions in storage order"`
  - `pnpm exec vitest run packages/server/test/services/spine-services.test.ts -t "keeps ID-filter QueryService reads working through direct handlers|reads all projection states through QueryService include-all queries|keeps QueryService include-all reads isolated by tenant|returns stable errors for include-all read failures|treats include-all query tenant domain and email variants as present"`
- Required verification:
  - `pnpm typecheck` ✅
  - `pnpm lint` ✅
  - `pnpm format:check` ✅ after formatting
    `build-protocol/work-logs/T-0012-11.md`
  - `pnpm docs:check` ✅
  - `git diff --check` ✅
  - `pnpm test:coverage` ✅ after rerunning outside sandbox; coverage result:
    45 files, 586 tests, statements 94.97%, branches 90.01%, functions 97.51%,
    lines 94.99%
  - Review-fix focused verification from `13b1244`:
    - `pnpm exec vitest run packages/server/test/stand/stand.test.ts -t "reads all stored entity states with their versions in storage order|returns copy-safe list read results for state and version|closes the storage handle after successful list reads|closes the storage handle when list reads reject"` ✅
    - `pnpm exec vitest run packages/server/test/services/spine-services.test.ts -t "reads all projection states through QueryService include-all queries|returns stable errors for include-all read failures|treats include-all query tenant domain and email variants as present"` ✅
    - `pnpm typecheck` ✅
    - `pnpm lint` ✅
    - `pnpm format:check` ✅
    - `pnpm docs:check` ✅
    - `git diff --check` ✅
  - Final verification after docs re-review:
    - `pnpm exec vitest run packages/server/test/stand/stand.test.ts -t "reads all stored entity states with their versions in storage order|returns copy-safe list read results for state and version|closes the storage handle after successful list reads|closes the storage handle when list reads reject"` ✅
    - `pnpm exec vitest run packages/server/test/services/spine-services.test.ts -t "keeps ID-filter QueryService reads working through direct handlers|reads all projection states through QueryService include-all queries|keeps QueryService include-all reads isolated by tenant|returns stable errors for include-all read failures|treats include-all query tenant domain and email variants as present"` ✅
    - `pnpm typecheck` ✅
    - `pnpm lint` ✅
    - `pnpm format:check` ✅
    - `pnpm docs:check` ✅
    - `git diff --check` ✅
    - sandboxed `pnpm test:coverage` failed only on local endpoint permissions
      (`Operation not permitted` for ZeroMQ IPC and
      `listen EPERM: operation not permitted 127.0.0.1` for gRPC tests)
    - escalated `pnpm test:coverage` ✅ with 45 files and 589 tests;
      statements 94.97%, branches 90.01%, functions 97.51%, lines 94.99%

Sandbox notes:

- One attempted focused gRPC query test run failed with
  `listen EPERM: operation not permitted 127.0.0.1`, so the new query tests
  use direct registered handlers for sandbox-safe red/green coverage.
- An in-sandbox `pnpm test:coverage` attempt also hit endpoint/IPC-sensitive
  tests before completion; the required coverage run passed when rerun outside
  the sandbox.

## Review Summary

Self-review pass: kept the change narrow to `Stand` plus `QueryService.Read`,
used `RecordStorage.query()` directly, avoided new query abstractions, and
added only the targeted tests needed to cover include-all reads, tenant
behavior, sanitized errors, and unchanged ID-filter behavior.

Review-fix pass: updated the public docs to describe direct list reads,
`Target.include_all` query handling, deterministic storage-order results, and
tenant-option behavior; added focused stand tests for list-read handle cleanup
and copy-safe state/version results; and tightened `packVersionedState()` so
the schema/result generic relation stays intact.

Final review status: code style/maintainability, documentation,
TypeScript/API docs, security, and performance/reliability lanes reported no
remaining comments.
