# T-0022b Implementation Report

Status: implemented in code/docs; round-eleven style fix applied; re-review pending
Date: `2026-07-10`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0022b-process-manager-event-inbox-handoff`
Branch: `task/T-0022b-process-manager-event-inbox-handoff`
Base commit: `eccbbb1`

## Summary

Implemented the narrow durable local inbox handoff for live process-manager
event reactions and event-commanding handlers.

- Live routed process-manager events write `REACT_UPON_EVENT` inbox rows before
  handler execution.
- Rows preserve the original framework `Event` envelope, original event ID, the
  process-manager state type URL, and the routed process-manager ID.
- Local replay drains only the exact row target and reuses the existing
  process-manager execution path for state, produced commands, produced events,
  tenant-scoped `Stand` updates, and failure propagation.
- Batch process-manager inbox handoffs coordinate each row in the same
  tenant-aware in-flight namespace as single-row handoffs, so mixed
  single-vs-batch duplicates wait for the original exact-row drain instead of
  racing the shard lease.
- Round-one review fixes consolidated duplicated inbox-event reading, replaced
  the `fromBinary(...toBinary(...))` copy path with generated `Any` rebuilding,
  shortened the new helper/test names, and updated docs to describe the replay
  safety contract.

## Review Fixes

Round-one findings fixed in this pass:

1. Code style/maintainability
   - consolidated process-manager/projection inbox event reading in
     `packages/server/src/repository/repository.ts`;
   - replaced the `fromBinary(AnySchema, toBinary(AnySchema, ...))` copy path
     with generated `Any` rebuilding via `create(AnySchema, { ... value: new
     Uint8Array(...) })` before unpacking;
   - shortened new helper names such as `handoffPmEvent`, `replayPmInbox`,
     `readPmInboxEvent`, `requirePmEventTenant`, `createInboxCheckRepo`,
     `createBlockingPmRepo`, and `storePmInboxEvent`.
2. Documentation/API docs
   - removed stale direct-event-bus prose from
     `docs/api/README.md`;
   - documented the replay safety contract in
     `build-protocol/DEVELOPER_API.md`,
     `build-protocol/RUNTIME_ARCHITECTURE.md`, `packages/server/README.md`,
     `docs/USER_GUIDE.md`, and `docs/api/README.md`;
   - updated internal JSDoc for `ProcessManagerInboxTarget` and
     `ProcessManagerInbox` so they describe process-manager inbox replay
     generally instead of command-only replay.
3. Durable docs
   - updated task/work-log status for the review-fix round;
   - added this implementation report and recorded the fix actions plus
     verification trail.

Round-two findings fixed in this pass:

1. Code style/maintainability
   - shortened `validateProcessManagerReplayTenant` to
     `validatePmReplayTenant`;
   - updated the process-manager replay caller to use the shorter helper name.
2. Reliability
   - added a regression covering a routed multi-target process-manager event
     where the first replay fails and a later target row still lands in durable
     inbox storage;
   - changed process-manager multi-target event handoff to write every routed
     inbox row before replaying them in order, so a failing earlier target
     leaves later rows retryable without changing exact-row replay.
3. Durable docs
   - corrected the impossible round-one fix timestamps in the work log;
   - updated this report's date and changed-file inventory to match the task's
     actual chronology and file surface.

Round-three findings fixed in this pass:

1. Code style/maintainability
   - shortened the split-route regression helper to `createSplitPmRepo`.
2. TypeScript/API docs
   - narrowed the internal process-manager inbox input/message contracts to the
     process-manager labels and `TO_DELIVER` status used by this handoff.
3. Durable docs
   - updated the review summary table to reflect the latest lane state.

Round-four findings fixed in this pass:

1. Documentation
   - corrected stale round-two status wording in the work log and this report.
2. TypeScript/API docs
   - narrowed process-manager replay messages to the `TO_DELIVER` status used
     by local inbox replay.

Round-five findings fixed in this pass:

1. Code style/maintainability
   - removed unused Protobuf binary imports;
   - made the split-route process-manager regression helper synchronous;
   - replaced the unsafe nested matcher with direct row inspection.
2. Durable docs
   - updated the review log through round five;
   - clarified the stalled-worker handoff wording in the work log.

Round-six findings fixed in this pass:

1. Performance/reliability
   - moved multi-target prewrite into `LocalProcessManagerInbox.receiveAll()`
     so every prewritten row uses the same monotonic local inbox version
     allocator as the single-row handoff.
2. Durable docs
   - updated the review log through round six.

Round-seven findings fixed in this pass:

1. Performance/reliability
   - coordinate concurrent duplicate multi-target process-manager event handoffs
     through `LocalProcessManagerInbox.receiveAll()` using a tenant-aware batch
     key derived from all input handoff keys;
   - added a regression for concurrent duplicate multi-target PM event delivery
     that failed pre-fix with skipped delivery while the original batch owned
     the shard lease.
2. Durable docs
   - update the review log, work log, and implementation report so round-seven
     status is current.

Round-eight findings fixed in this pass:

1. Durable docs
   - normalized the work-log chronology so round-seven review/fix entries follow
     the recorded round-six verification entry;
   - updated the review log and this report to record round-eight lane status.

Round-nine findings fixed in this pass:

1. Performance/reliability
   - added mixed duplicate regressions for batch-to-single and single-to-batch
     process-manager event handoffs;
   - changed `LocalProcessManagerInbox.receiveAll()` to reserve per-row
     handoff promises in the same map used by `receive()` before writing batch
     rows;
   - kept exact duplicate batch promise reuse, write-all-before-drain behavior,
     and the existing `#takeVersion()` allocator;
   - ensured owned row promises resolve after exact-row drain and reject/clean
     up on failure.
2. Durable docs
   - updated `docs/architecture/README.md` to cover command, projection, and
     process-manager event handoffs, including `REACT_UPON_EVENT` row contents
     and pre-handler validation;
   - updated the work log, review log, and this report for round nine.

Round-ten findings fixed in this pass:

1. Code style/maintainability
   - moved supporting process-manager inbox aliases and interfaces below the
     primary `LocalProcessManagerInbox` class and before helper functions.

Round-eleven findings fixed in this pass:

1. Code style/maintainability
   - shortened the review-log lane note and wrapped long work-log command
     evidence lines to stay within the line-length rule.

## Files Changed

- `packages/server/src/context/process-manager-handoff.ts`
- `packages/server/src/repository/repository.ts`
- `packages/server/test/context/process-manager-handoff.test.ts`
- `packages/server/test/repository/repository-routing.test.ts`
- `docs/architecture/README.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DECISION_LOG.md`
- `packages/server/README.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `build-protocol/reviews/T-0022b-process-manager-event-inbox-handoff.md`
- `build-protocol/tasks/T-0022b-process-manager-event-inbox-handoff/TASK.md`
- `build-protocol/tasks/T-0022b-process-manager-event-inbox-handoff/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0022b.md`

## Verification

Passed:

- focused repository/process-manager replay tests
  - command:
    `pnpm --config.verify-deps-before-run=false exec vitest run`
    `packages/server/test/context/process-manager-handoff.test.ts`
    `packages/server/test/repository/repository-routing.test.ts`
  - exit `0`
  - result: `2` files passed, `136` tests passed
- `pnpm --config.verify-deps-before-run=false --filter @spine-ts/server test`
  - exit `0`
- `pnpm --config.verify-deps-before-run=false docs:check`
  - exit `0`
  - note: TypeDoc reported the existing invalid-`origin` source-link warning
    and the API docs check confirmed `214` expected `@spine-ts/server` exports
    plus the expected counts for the other workspace packages
- round-seven focused regression red check
  - command:
    `pnpm --config.verify-deps-before-run=false exec vitest run`
    `packages/server/test/context/process-manager-handoff.test.ts`
    `-t "waits for a concurrent duplicate multi-target event batch"`
  - expected pre-fix exit `1`
  - result: failed with
    `Process-manager inbox delivery was skipped before the target row was delivered.`
- round-seven focused regression green check
  - command:
    `pnpm --config.verify-deps-before-run=false exec vitest run`
    `packages/server/test/context/process-manager-handoff.test.ts`
    `-t "waits for a concurrent duplicate multi-target event batch"`
  - exit `0`
  - result: `1` test passed, `11` skipped
- round-seven focused suite
  - command:
    `pnpm --config.verify-deps-before-run=false exec vitest run`
    `packages/server/test/context/process-manager-handoff.test.ts`
    `packages/server/test/repository/repository-routing.test.ts`
  - exit `0`
  - result: `2` files passed, `137` tests passed
- `pnpm --config.verify-deps-before-run=false lint:generated`
  - exit `0`
  - result: `tsc -b`, ESLint, and cleanup enforcement passed
- round-eight documentation fix verification
  - command: `pnpm --config.verify-deps-before-run=false docs:check`
  - exit `0`
  - note: TypeDoc reported the existing invalid-`origin` source-link warning
  - command: `git diff --check`
  - exit `0`
- round-nine mixed duplicate regression red check
  - command:
    `pnpm --config.verify-deps-before-run=false exec vitest run`
    `packages/server/test/context/process-manager-handoff.test.ts`
    `-t "duplicate single row|duplicate batch row"`
  - expected pre-fix exit `1`
  - result: both new tests failed with
    `Process-manager inbox delivery was skipped before the target row was delivered.`
- round-nine mixed duplicate regression green check
  - command:
    `pnpm --config.verify-deps-before-run=false exec vitest run`
    `packages/server/test/context/process-manager-handoff.test.ts`
    `-t "duplicate single row|duplicate batch row"`
  - exit `0`
  - result: `1` file passed, `2` tests passed, `12` skipped
- round-nine focused suite
  - command:
    `pnpm --config.verify-deps-before-run=false exec vitest run`
    `packages/server/test/context/process-manager-handoff.test.ts`
    `packages/server/test/repository/repository-routing.test.ts`
  - exit `0`
  - result: `2` files passed, `139` tests passed
- round-nine final generated/lint verification
  - command: `pnpm --config.verify-deps-before-run=false lint:generated`
  - exit `0`
  - result: TypeScript build, ESLint, and cleanup enforcement passed
- round-nine final documentation verification
  - command: `pnpm --config.verify-deps-before-run=false docs:check`
  - exit `0`
  - note: TypeDoc reported the existing invalid-`origin` source-link warning
    and the API docs check confirmed the expected exported symbol counts
- `git diff --check`
  - exit `0`
- round-ten style fix verification
  - command: `pnpm --config.verify-deps-before-run=false lint:generated`
  - exit `0`
  - result: TypeScript build, ESLint, and cleanup enforcement passed
  - command:
    `pnpm --config.verify-deps-before-run=false exec vitest run`
    `packages/server/test/context/process-manager-handoff.test.ts`
    `packages/server/test/repository/repository-routing.test.ts`
  - exit `0`
  - result: `2` files passed, `139` tests passed
  - command: `pnpm --config.verify-deps-before-run=false docs:check`
  - exit `0`
  - note: TypeDoc reported the existing invalid-`origin` source-link warning
  - command: `git diff --check`
  - exit `0`
- round-eleven style fix verification
  - first parallel `lint:generated` attempt exited `1` because it raced with
    concurrent `docs:check` proto generation and ESLint saw a transient
    ignored `.generated-*` directory
  - rerun command: `pnpm --config.verify-deps-before-run=false lint:generated`
  - exit `0`
  - command:
    `pnpm --config.verify-deps-before-run=false exec vitest run`
    `packages/server/test/context/process-manager-handoff.test.ts`
    `packages/server/test/repository/repository-routing.test.ts`
  - exit `0`
  - result: `2` files passed, `139` tests passed
  - command: `pnpm --config.verify-deps-before-run=false docs:check`
  - exit `0`
  - note: TypeDoc reported the existing invalid-`origin` source-link warning
  - command: `git diff --check`
  - exit `0`

## Remaining Deferrals

- no generic repository delivery engine;
- no aggregate reactor/importer inbox handoff;
- no projection catch-up inbox routing;
- no scheduler, retry monitor, or transport worker;
- no retained attempt history or new public end-user API.
