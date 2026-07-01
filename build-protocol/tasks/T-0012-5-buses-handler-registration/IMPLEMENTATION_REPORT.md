# Implementation Report: T-0012.5 CommandBus, EventBus, And Handler Registration

Status: implementation selected
Branch: `task/T-0012-5-buses-handler-registration`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-5-buses-handler-registration`
Baseline commit: `746e862`

## Summary

Implementation has not yet started. The baseline was verified after dependency
setup.

The task starts after the corrected storage seam. It should add the first bus
layer only: command unicast registration/dispatch, event multicast
registration/dispatch, and store-before-dispatch through `EventStore`.

## JVM Alignment

Spine JVM establishes:

- `CommandBus` as a unicast bus with duplicate dispatcher rejection;
- `EventBus` as a multicast bus that appends events to `EventStore` before
  dispatch;
- `@Assign`, `@Command`, `@Subscribe`, `@React`, and `@Apply` as the familiar
  handler vocabulary.

This task should keep that conceptual shape without implementing later
bounded-context, repository, delivery, stand, or service layers.

## Verification

Baseline:

- `env CI=true corepack pnpm verify` passed.
- 32 test files and 294 tests passed.
- Coverage: statements 95.64%, branches 90.44%, functions 98.31%, lines 95.64%.
- Docs/API checks passed with the existing invalid-`origin` TypeDoc warning.
- Proto lint/generate and generated-clean comparison passed.

## Changed Files

Pending implementation.
