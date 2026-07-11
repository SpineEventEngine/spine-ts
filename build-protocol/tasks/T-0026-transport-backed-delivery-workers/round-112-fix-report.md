# Round 112 Docs/API-Docs Fix Report

Timestamp: `2026-07-11T02:41:09Z`

Scope: docs/API-docs only; no runtime behavior changes.

## Findings Addressed

- Documentation P3: the Round 7 review-log evidence said a `CATCH_UP` row
  recorded a failed run and cleared its claim. That local historical evidence is
  now marked as superseded by Round 22/current semantics: `CATCH_UP` remains
  pending and is skipped before row acceptance, storage claiming, callback
  invocation, failure recording, and failure-budget consumption.
- TypeScript/API docs P2: `InboxReadOptions.limit` TypeDoc and curated API docs
  now state that the limit must be positive and at most `1000`.
- TypeScript/API docs P2: `ShardedWorkRegistryOptions.leaseMs` TypeDoc and
  curated API docs now state that the lease must be between `1000` and
  `2147483647` milliseconds inclusive.

## Verification

- `pnpm --config.verify-deps-before-run=false docs:check` passed with only the
  known TypeDoc invalid-origin source-link warning.
- `pnpm --config.verify-deps-before-run=false format:check` passed.
- `git diff --check` passed.
- Stale exact Round 7 `CATCH_UP` failed-run evidence guard returned no matches.
- Positive cap-wording guards found the `InboxReadOptions.limit` and
  `ShardedWorkRegistryOptions.leaseMs` caps in source/API docs.
