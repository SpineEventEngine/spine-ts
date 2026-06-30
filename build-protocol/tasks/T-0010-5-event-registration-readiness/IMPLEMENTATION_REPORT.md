# Implementation Report: T-0010.5 Event Registration Readiness

Status: Implementation Complete; Verification Passed
Task log:
`build-protocol/tasks/T-0010-5-event-registration-readiness/TASK.md`
Work log: `build-protocol/work-logs/T-0010-5.md`
Review log: `build-protocol/reviews/T-0010-5-event-registration-readiness.md`
Branch: `task/T-0010-5-event-registration-readiness`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0010-5-event-registration-readiness`

## Summary

T-0010.5 starts from parent runtime branch commit `20aaad1`, after T-0010.4
command registration readiness was integrated and verified. This implementation
adds a metadata-only event registration readiness lookup over existing handler
metadata, not an event bus or integration broker.

`EventRegistrationReadiness` can be built from a
`HandlerMetadataRegistryLookup` or iterable `EntityHandlersMetadata`. It
reports deterministic event full type names, preserves subscriber/reactor
fan-out, groups event applications by event type, and returns fresh frozen
copy-safe readiness metadata. Duplicate event application policy remains owned
by `HandlerMetadataRegistry`.

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

## Files Changed

- `packages/server/src/event-registration-readiness.ts`
- `packages/server/src/event-registration-readiness.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `packages/server/README.md`
- `docs/api/README.md`
- `scripts/check-api-docs.mjs`
- `build-protocol/tasks/T-0010-5-event-registration-readiness/TASK.md`
- `build-protocol/tasks/T-0010-5-event-registration-readiness/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0010-5.md`

No additional source files were needed beyond the expected event readiness,
exports, docs, API checker, and durable task logs.

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
- RED on `2026-06-30 18:24 WEST`: `corepack pnpm test
packages/server/src/event-registration-readiness.test.ts` failed with 9/9
  tests failing because `EventRegistrationReadiness` was not exported.
- GREEN on `2026-06-30 18:26 WEST`: `corepack pnpm test
packages/server/src/event-registration-readiness.test.ts` passed with 1 test
  file / 9 tests.
- Focused export GREEN on `2026-06-30 18:27 WEST`: `corepack pnpm test
packages/server/src/event-registration-readiness.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 18 tests.
- Typecheck on `2026-06-30 18:27 WEST`: first `corepack pnpm typecheck`
  failed on one generic cast in the event readiness test helper; after the cast
  was tightened through `unknown`, `corepack pnpm typecheck` passed with
  `tsc -b` and `tsc --noEmit -p tsconfig.eslint.json`.
- Full verification on `2026-06-30 18:31 WEST`: `CI=true corepack pnpm verify`
  passed with 21 test files / 251 tests, coverage 95.95% statements / 90.43%
  branches / 97.78% functions / 95.89% lines, TypeDoc/API checks with 100
  proto / 28 core / 124 server / 26 storage expected exports, proto
  lint/generate checksum verification, and generated proto output clean.

## Concerns

- External/domestic event classification is intentionally deferred because the
  current TS handler metadata has no external-event marker. The implementation
  documents this in JSDoc, package README, and API README rather than inventing
  new annotations.
- No runtime event delivery, broker, import/replay, storage, dispatch,
  repository runtime registration, transport, validation, handler invocation,
  command-result subscription, or `Ack` surface was added.
