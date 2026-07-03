# T-0012.8 Round 61 Fix Report

Status: verified; commit pending.

Changed files:

- `packages/server/src/delivery/sharded-work-registry.ts`
- `packages/server/test/delivery/sharded-work-registry.test.ts`
- `packages/storage/src/record/record-storage.ts`
- `docs/api/README.md`
- `build-protocol/tasks/T-0012-8-delivery-inbox/TASK.md`
- `build-protocol/tasks/T-0012-8-delivery-inbox/IMPLEMENTATION_REPORT.md`
- `build-protocol/reviews/T-0012-8-delivery-inbox.md`
- `build-protocol/work-logs/T-0012-8.md`
- `.superpowers/sdd/T-0012-8-round-61-fix-report.md`

Red-first evidence:

- `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
  failed before production changes with the new pickup-shard regression because
  `pickUp()` leaked raw `Shard index confidential getter failed` instead of
  stable `Shard index is invalid.`.

Verification commands and results:

- Red-first focused shard-registry command: failed as expected.
- Green focused shard-registry command: passed.
- `pnpm test`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`: passed, 2
  files and 46 tests.
- `pnpm test`
  `packages/server/test/index.test.ts`
  `packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/shard-index.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts`: passed, 7 files
  and 175 tests.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `node scripts/check-api-docs.mjs`: passed with the pre-existing invalid
  `origin` TypeDoc source-link warning.
- `git diff --check fce80b2..HEAD`: passed.
- Touched-file line-length scan for lines over 120 columns: passed with no
  output.

Commit hash:

- Current package HEAD after commit; final response records the concrete hash.

Concerns:

- `node scripts/check-api-docs.mjs` still emits the pre-existing invalid
  `origin` TypeDoc source-link warning while exiting successfully.
