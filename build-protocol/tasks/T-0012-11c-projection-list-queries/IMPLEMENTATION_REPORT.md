# Implementation Report: T-0012.11c Projection List Queries

Status: in progress
Branch: `task/T-0012-11c-projection-list-queries`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11c-projection-list-queries`
Baseline commit: `8caec30`

## Summary

This slice adds the smallest read-side list query path needed by the to-do
example: projection-state `include_all` reads through `QueryService.Read`.

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
  projection-state queries, validates tenant constraints before execution, and
  packs each result as `EntityStateWithVersion` with the same `Any` + `Version`
  shape used by ID-filter reads.
- ID-filter reads continue through the existing `readVersioned()` path.
- Include-all read failures return the existing sanitized
  `QUERY_READ_ERROR` response.
- README and task logs were updated to document the new list-read behavior and
  the verification evidence.

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
  - `pnpm docs:check` ✅
  - `git diff --check` ✅
  - `pnpm test:coverage` ✅ after rerunning outside sandbox; coverage result:
    45 files, 586 tests, statements 94.97%, branches 90.01%, functions 97.51%,
    lines 94.99%
  - `pnpm format:check` ⚠️ still fails on pre-existing unrelated file
    `build-protocol/work-logs/T-0012-11.md`

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
