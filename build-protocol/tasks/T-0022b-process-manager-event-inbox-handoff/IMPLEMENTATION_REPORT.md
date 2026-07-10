# T-0022b Implementation Report

Status: implemented in code/docs; awaiting re-review
Date: `2026-07-09`
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

## Files Changed

- `packages/server/src/repository/repository.ts`
- `packages/server/test/repository/repository-routing.test.ts`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `packages/server/README.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
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
  - result: `2` files passed, `135` tests passed
- `pnpm --config.verify-deps-before-run=false --filter @spine-ts/server test`
  - exit `0`
- `pnpm --config.verify-deps-before-run=false docs:check`
  - exit `0`
  - note: TypeDoc reported the existing invalid-`origin` source-link warning
    and the API docs check confirmed `214` expected `@spine-ts/server` exports
    plus the expected counts for the other workspace packages

## Remaining Deferrals

- no generic repository delivery engine;
- no aggregate reactor/importer inbox handoff;
- no projection catch-up inbox routing;
- no scheduler, retry monitor, or transport worker;
- no retained attempt history or new public end-user API.
