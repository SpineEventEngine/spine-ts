# T-0012.8 Round 62 Fix Report

Status: committed as `2abf091`.
Branch: `task/T-0012-8-delivery-inbox`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-8-delivery-inbox`
Previous completed commit: `fa7045a`

## Reviewer Results

- CLEAN: code style/maintainability, TypeScript/API docs, and
  performance/reliability.
- CHANGES_REQUESTED: security and documentation.

## Fix Summary

- Extended the shard pickup accessor regression so it inspects the actual
  rejection object and asserts `confidential getter failed` is absent from the
  public message, `.cause`, and JSON diagnostic surface while storage opens
  remain zero.
- Removed raw `cause` attachment from `requireInputShard()` caller shard
  property access failures. Deterministic invalid integer validation and
  `ShardIndex` constructor validation paths remain unchanged.
- Rewrote the work-log tail so the round-61 docs cleanup starts and verifies
  before committed `fa7045a`, with `fa7045a` recorded as the current package
  HEAD at round-62 review intake.

## Verification

- Red-first focused shard test:
  `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
  failed as expected because `indexRejection.cause` exposed
  `Shard index confidential getter failed`; storage open assertions remained
  part of the failing regression.
- Green focused shard test:
  `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
  passed with 1 file and 33 tests.
- Shard/storage pair passed with 2 files and 46 tests:
  `pnpm test`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`.
- Focused task suite passed with 7 files and 175 tests:
  `pnpm test`
  `packages/server/test/index.test.ts`
  `packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/shard-index.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts`.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm format:check` passed after durable-log edits.
- `node scripts/check-api-docs.mjs` passed after durable-log edits with the
  pre-existing invalid `origin` TypeDoc source-link warning.
- `git diff --check fce80b2..HEAD` passed after durable-log edits.
- Touched-file line scan passed with no lines over 120 columns after
  durable-log edits.

## Concerns

- The API docs command continues to emit the pre-existing invalid `origin`
  warning while exiting successfully.
