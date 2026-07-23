# T-0064 Implementation Report

Status: verified; all required reviews and the full repository gate pass.

## TDD evidence

- RED: `../../node_modules/.bin/vitest run packages/delivery-server/test/public-api.test.ts`
  failed as expected before the package existed: `Cannot find module '../src/index.js'`.
- GREEN: after workspace links and frozen generated Proto became available,
  `pnpm vitest run packages/delivery-server/test
packages/delivery-client/test/remote-adapters-quarantine.test.ts` passed
  16 tests across 3 files.
- Additional admission and shard RED/GREEN slices now pass through
  `pnpm vitest run packages/delivery-server/test` (7 tests): pre-admission
  cancellation, FIFO, the 100 pending-operation bound, exclusive contention,
  release/reacquisition, and timeout equality semantics.
- Final focused gate: `pnpm vitest run packages/delivery-server/test
packages/delivery-client/test/in-memory-core-response-loss.test.ts
packages/delivery-client/test/remote-adapters-quarantine.test.ts` passed 38
  tests across 7 files; generated build/tooling typechecks, touched ESLint,
  TypeDoc/API check, Prettier, and `git diff --check` passed.

## Implemented behavior

- Listener-free public in-memory core with Inbox and Shard Connect handler seams.
- Detached canonical message/shard records, strict wire timestamp paging,
  UUID-stabilized ordering, direct upsert/remove semantics, bounded pages, and
  FIFO mutation admission.
- Strict automatic stale pickup, manual inclusive expiration, worker-agnostic
  explicit release, and retained released shard records.
- RemoteInbox continuation now queries one millisecond before its timestamp
  anchor and fails before RPC at the Protobuf `Timestamp` lower bound.

## Limitations and exclusions

- The core remains intentionally listener-free. Admin observation, health,
  configuration, and process lifecycle stay deferred to T-0065. Router tests
  prove response-loss reconciliation through direct follow-up state outcomes;
  Admin `NOT_PICKED` observation is therefore not claimed here.

## Consolidated review corrections

- Moved private runtime and mirrored tests under cohesive `core/` folders.
- Protobuf-cloned stored and returned workers; response mutation cannot alias
  canonical session state. Removed the dead receive-time helper.
- Guarded continuation at the Protobuf timestamp minimum and validated direct
  find, release, and optional paging fields as `InvalidArgument`.
- Removed the false 100-session client response cap. Router tests observe 101
  released sessions and classify an oversized post-commit expiration response
  as `DeliveryOutcomeUnknownError` with `ALL_SHARDS` reconciliation.
- Expanded package documentation with runnable caller-owned router registration,
  timing/cancellation boundaries, finite admission, restart/trust limitations,
  and explicit T-0065 exclusions.
- Correction verification passed 41 focused core/router/adapter tests, 76
  non-network delivery-client regressions, and the real HTTP/2 delivery-client
  integration test. Generated build/tooling typechecks, full ESLint/cleanup,
  cleanup-rule fixtures, TypeDoc/API docs, repository Prettier, and diff checks
  pass.

## Final task gate

- All required style, documentation, TypeScript/API, and
  performance/reliability concerns converged with no P0/P1/P2 remaining.
- Full `pnpm --config.verify-deps-before-run=false verify` passed 116 test
  files / 2,268 tests with 3 files / 21 tests skipped.
- Global branch coverage is 7,147/7,933 (90.09%).
- Generated build/tooling typechecks, full ESLint/cleanup, repository
  formatting, exact TypeDoc/API inventory, copied Proto checksums, frozen
  descriptor lint, generated drift, and release readiness all passed.
- Final narrow validation now rejects impossible `ShardIndex` values where
  `index >= ofTotal` before Inbox or Shard admission. RED tests first proved
  write and pickup incorrectly succeeded; GREEN tests cover Inbox write/find/page
  and Shard pickup/release while proving no impossible session is retained.
