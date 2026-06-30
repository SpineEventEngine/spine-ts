# Implementation Report: T-0010.5 Event Registration Readiness

Status: Review Complete; No Open Findings
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

Review fixes after implementation commit `a453757` were applied by extracting
the shared readiness metadata clone/comparator logic into a private server
helper used by both command and event readiness. Event readiness now
canonicalizes custom registry lookups through `HandlerMetadataRegistry` before
building event indexes, and readiness metadata snapshots freeze cloned
handler schema/descriptor objects while preserving entity field identity within
each returned metadata value. Review-fix sub-agent
`019f199d-9b3a-76f0-887b-5ea128774140` authored the fix commit.

Final re-review is clean across all required lanes. A documentation re-review
found one remaining audit-log gap, which was fixed in `dc55fa3`; the second
documentation re-review reported clean. All participating implementation,
review-fix, and reviewer sub-agents were closed.

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
- `packages/server/src/command-registration-readiness.ts`
- `packages/server/src/command-registration-readiness.test.ts`
- `packages/server/src/registration-readiness-metadata.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `packages/server/README.md`
- `docs/api/README.md`
- `scripts/check-api-docs.mjs`
- `build-protocol/tasks/T-0010-5-event-registration-readiness/TASK.md`
- `build-protocol/tasks/T-0010-5-event-registration-readiness/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0010-5.md`

The new `registration-readiness-metadata.ts` helper is internal to server
source modules and is not exported from the package index.

## Review Findings

- Maintainability reviewer `019f1999-9c26-7c80-868d-1c54f56daa6e`:
  Important shared helper duplication. Fixed by moving deterministic
  comparison, readiness metadata cloning, and metadata array-map copying into
  `registration-readiness-metadata.ts`.
- Documentation reviewer `019f1999-cfd4-7ed3-a88a-f23f3a75c943`: Important
  missing authoring sub-agent ID; Minor stale review log. Fixed by recording
  authoring sub-agent `019f198d-7dc2-7641-9abb-4c49d776e370`, reviewer IDs,
  review-fix sub-agent `019f199d-9b3a-76f0-887b-5ea128774140`, finding
  dispositions, and current review-fix status in durable logs.
- TypeScript/API reviewer `019f199a-0079-7cf3-ab60-78f8c7286dac`: clean. No
  code change required.
- Security reviewer `019f199a-38dc-7a90-bc98-5a3a08efd62e`: Important
  schema/descriptor mutation poisoning. Fixed by cloning and freezing
  handler/entity schema and descriptor objects in readiness snapshots.
- Performance/reliability reviewer
  `019f199a-6696-7061-b129-bdc51f12ef81`: Important custom lookup duplicate
  application bypass; Important entity field identity; Minor repeated cloning.
  Fixed by canonicalizing event `fromRegistry()` through
  `HandlerMetadataRegistry`, preserving field metadata identity with a clone
  map, and reusing immutable nested snapshots while returning fresh outer
  metadata values.

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
- Review-fix RED on `2026-06-30 18:42 WEST`: `corepack pnpm test
packages/server/src/command-registration-readiness.test.ts
packages/server/src/event-registration-readiness.test.ts` failed as expected
  with 5 focused regressions: schema/descriptor metadata was not frozen,
  entity field metadata identity was split, and custom lookup duplicate event
  applications did not throw.
- Review-fix focused GREEN on `2026-06-30 18:45 WEST`: `corepack pnpm test
packages/server/src/command-registration-readiness.test.ts
packages/server/src/event-registration-readiness.test.ts` passed with 2 test
  files / 22 tests.
- Review-fix typecheck on `2026-06-30 18:45 WEST`: `corepack pnpm typecheck`
  passed with `tsc -b` and `tsc --noEmit -p tsconfig.eslint.json`.
- Review-fix full verification attempts on `2026-06-30 18:46-18:47 WEST`:
  `CI=true corepack pnpm verify` first failed on one ESLint
  `no-unsafe-argument` finding in the helper clone utility; after switching to
  `Reflect.getPrototypeOf()`, it failed on Prettier formatting for
  `build-protocol/work-logs/T-0010-5.md`; formatting the touched durable logs
  resolved it.
- Review-fix full verification on `2026-06-30 18:50 WEST`: `CI=true corepack
pnpm verify` passed with 21 test files / 256 tests, coverage 96.45%
  statements / 90.55% branches / 99.24% functions / 96.39% lines, TypeDoc/API
  checks with 100 proto / 28 core / 124 server / 26 storage expected exports,
  proto lint/generate checksum verification, and generated proto output clean.
- Documentation audit-log verification on `2026-06-30 18:58 WEST`: after
  recording concrete review-fix sub-agent
  `019f199d-9b3a-76f0-887b-5ea128774140`, `CI=true corepack pnpm verify`
  passed with 21 test files / 256 tests, coverage 96.45% statements / 90.55%
  branches / 99.24% functions / 96.39% lines, TypeDoc/API checks with 100
  proto / 28 core / 124 server / 26 storage expected exports, proto
  lint/generate checksum verification, and generated proto output clean.

## Review Closure

- Maintainability re-review `019f19a9-50b9-7290-b6e0-5af1130724fa`: clean.
- Documentation re-review `019f19a9-82c1-7ff3-b537-897228a52f87`: remaining
  concrete review-fix worker ID finding fixed in `dc55fa3`.
- Documentation second re-review `019f19af-558f-7a12-8120-99ca1fbc69ee`:
  clean.
- TypeScript/API re-review `019f19a9-b631-7ef0-bc34-1704f5bcdc1a`: clean.
- Security re-review `019f19a9-ea3e-7ee0-9c64-71072b39822b`: clean.
- Performance/reliability re-review `019f19aa-218e-7033-aed6-c56d2d2662db`:
  clean.
- All participating implementation, review-fix, and reviewer sub-agents were
  closed by the main orchestrator.

## Concerns

- External/domestic event classification is intentionally deferred because the
  current TS handler metadata has no external-event marker. The implementation
  documents this in JSDoc, package README, and API README rather than inventing
  new annotations.
- No runtime event delivery, broker, import/replay, storage, dispatch,
  repository runtime registration, transport, validation, handler invocation,
  command-result subscription, or `Ack` surface was added.
