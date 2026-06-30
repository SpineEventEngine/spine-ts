# Implementation Report: T-0010.5 Event Registration Readiness

Status: Setup Baseline Verified; Implementation Pending
Task log:
`build-protocol/tasks/T-0010-5-event-registration-readiness/TASK.md`
Work log: `build-protocol/work-logs/T-0010-5.md`
Review log: `build-protocol/reviews/T-0010-5-event-registration-readiness.md`
Branch: `task/T-0010-5-event-registration-readiness`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0010-5-event-registration-readiness`

## Summary

T-0010.5 starts from parent runtime branch commit `20aaad1`, after T-0010.4
command registration readiness was integrated and verified. The intended slice
is a metadata-only event registration readiness lookup over existing handler
metadata, not an event bus or integration broker.

## JVM Research Used

Setup inspected task-relevant Spine JVM event registration sources:

- `spine-server-runtime-and-bounded-context.md`;
- `spine-routing-dispatch-and-delivery.md`;
- `EventDispatcherRegistry.java`;
- `EventDispatcher.java`;
- `EventDispatcherDelegate.java`;
- `EventSubscriber.java`;
- `EventReactor.java`.

The key implementation constraint is multicast readiness: subscribers and
reactors fan out by event type, while event application remains unique per
entity state plus event type through `HandlerMetadataRegistry`.

## Files Expected To Change

- `packages/server/src/event-registration-readiness.ts`
- `packages/server/src/event-registration-readiness.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `packages/server/README.md`
- `docs/api/README.md`
- `scripts/check-api-docs.mjs`
- task, work, review, and decision logs

## Verification

- Setup install on `2026-06-30 18:15 WEST`: initial sandboxed
  `corepack pnpm install --frozen-lockfile` hit npm DNS restrictions and was
  interrupted before completion; escalated rerun completed with the frozen
  lockfile, 194 packages reused from pnpm store, 0 downloads, and no lockfile
  changes.
- Setup baseline verification on `2026-06-30 18:16 WEST`: `CI=true corepack
pnpm verify` passed with 20 test files / 242 tests, coverage 95.94%
  statements / 90.38% branches / 98.15% functions / 95.87% lines, TypeDoc/API
  checks with 100 proto / 28 core / 119 server / 26 storage expected exports,
  proto lint/generate checksum verification, and generated proto output clean.

## Concerns

- External/domestic event classification is intentionally deferred because the
  current TS handler metadata has no external-event marker. The implementation
  must document this rather than inventing new annotations.
