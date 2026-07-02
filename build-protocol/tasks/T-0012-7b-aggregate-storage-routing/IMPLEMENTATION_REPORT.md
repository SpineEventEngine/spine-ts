# Implementation Report: T-0012.7b Aggregate Storage And Signal Routing

Status: final verification passed; final review pending
Branch: `task/T-0012-7b-aggregate-storage-routing`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-7b-aggregate-storage-routing`
Baseline commit: `77492b9`

## Summary

Implemented the smallest aggregate storage and repository signal-routing slice.
`AggregateStorage` persists framework-owned aggregate snapshot records through
`StorageFactory`/`RecordStorage`, appends aggregate events through `EventStore`,
and reads history as optional latest snapshot plus events after that snapshot.
`Repository` now accepts explicit handler metadata, exposes `routeCommand()` and
`routeEvent()`, and supplies internal command/event dispatcher adapters to
bounded-context assembly. Actual entity handler invocation remains explicitly
deferred.

The implementation sub-agent started from handoff baseline `dcddec7` in the
existing task worktree. The checked-in task brief still records baseline
`77492b9`; this mismatch was recorded here and in the work log, and no reset or
rebase was performed.

## TDD Evidence

- RED: `corepack pnpm test packages/server/test/repository/aggregate-storage.test.ts packages/server/test/repository/repository-routing.test.ts`
  failed as expected with four focused failures:
  `AggregateStorage is not a constructor`, `repository.routeCommand is not a
function`, and `repository.routeEvent is not a function`.
- GREEN: the same focused command passed after adding `AggregateStorage`,
  repository route calculation, and internal repository command/event dispatcher
  adapters.

## Verification

- `corepack pnpm test packages/server/test/repository/aggregate-storage.test.ts packages/server/test/repository/repository-routing.test.ts`
  passed with 2 files and 7 tests after the review-fix regressions were added.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` initially failed because the new public server
  exports were not listed in the API guard and the `AggregateStorage` TypeDoc
  comment linked to a type outside the generated documentation set. After
  updating the API docs and guard expectations, `corepack pnpm docs:check`
  passed with the existing invalid-`origin` TypeDoc warning only.
- After the review-fix pass, the focused repository tests, `typecheck`, `lint`,
  `format:check`, and `docs:check` all passed. `docs:check` still reports the
  existing invalid-`origin` TypeDoc warning and exits successfully.

## Baseline Verification

- Initial sandboxed `env CI=true corepack pnpm verify` could not run before
  `pnpm install`.
- Sandboxed `corepack pnpm install` failed on registry DNS resolution.
- Escalated `corepack pnpm install` passed.
- Escalated `env CI=true corepack pnpm verify` passed.
- Test evidence: 35 test files, 299 tests.
- Coverage evidence: statements 95.57%, branches 90.50%, functions 96.78%,
  lines 95.62%.
- Docs/API checks passed with the existing invalid-`origin` TypeDoc warning.
- Proto lint/generate and generated-clean checks passed.

## JVM Evidence Read

- `spine-entities-repositories-and-state.md` aggregate section: aggregate
  history is source-of-truth; snapshots contain packed state, version,
  timestamp, and lifecycle; latest state is a side channel for indexes/query.
- `spine-routing-dispatch-and-delivery.md`: command routing is unicast,
  default route reads the first command field, event routing is multicast, and
  repository routing happens before inbox delivery.
- `spine-server-runtime-and-bounded-context.md`: repositories are registered as
  context parts; builder registration also diverts repository dispatchers
  through repository registration.
- Current TS `Repository`, `Aggregate`, `EntityTransaction`, `EventStore`, and
  `RecordStorage` sources were inspected.
- Concrete JVM source files referenced by the docs were not present under
  `/private/tmp/spine-research` in this session, so the checked-in research docs
  are the task evidence baseline.

## Review Status

Review round 1 findings addressed in the fix pass:

- Documentation now states that repository deferred route calculation and
  internal bounded-context dispatcher adapters exist, while handler invocation,
  inbox/delivery, entity storage/cache/catch-up, stand, gRPC, and transport
  remain deferred.
- `AggregateStorage` now appears before supporting declarations, preserves the
  aggregate ID generic, validates every appended event routes to the supplied
  aggregate ID, rejects missing versions, and rejects duplicate/non-increasing
  versions before storing a batch. History reads also reject invalid stored
  aggregate versions.
- The runtime-synthesized `spine.server.AggregateSnapshotRecord` descriptor was
  removed. Snapshot records now use an internal private `Any` payload shape
  rather than an ad hoc Spine namespace proto contract.
- Repository route methods preserve entity ID generics and TypeDoc now reflects
  deferred route calculation without implying handler invocation.
- Handler metadata produced by `defineEntityHandlers()` is now marked
  internally, and repository validation rejects structurally fabricated handler
  metadata before creating bus-visible dispatchers.

Final verification for the fix pass passed.

Review round 2 findings addressed in the follow-up fix pass:

- public docs now state that aggregate snapshot/history storage exists through
  `AggregateStorage`;
- aggregate event history reads sort aggregate events by version before
  duplicate-version validation, avoiding dependence on event-store ID order;
- `RepositoryOptions.handlers` now preserves the repository entity/state
  generic contract; and
- handler metadata authenticity is checked through an internal access object.

Verification after the round-2 fix pass:

- `corepack pnpm test packages/server/test/repository/aggregate-storage.test.ts packages/server/test/repository/repository-routing.test.ts`
  passed with 2 files and 8 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
  warning.

Review round 3 passed in all five required lanes with no remaining findings.
All round-3 reviewer sub-agents were closed.

Final verification initially exposed two post-review issues: the package-root
export smoke test did not include the new runtime `AggregateStorage` export, and
branch coverage fell below the 90% threshold after adding aggregate storage. The
fix updated the export smoke test and added focused aggregate-storage tests for
first-field primitive routing, unroutable events, corrupted internal snapshot
records, duplicate versions already stored in history, and event IDs that sort
differently from aggregate versions.

Final escalated `env CI=true corepack pnpm verify` passed. Evidence: 37 test
files, 312 tests, statements 95.45%, branches 90.04%, functions 96.73%, lines
95.49%. `docs:check` passed with the existing invalid-`origin` TypeDoc warning;
proto lint/generate and generated-clean checks passed.

## Concerns

- Scope must stay within aggregate storage and signal routing. Delivery,
  `Inbox`, `Stand`, gRPC, import bus, scheduler, and process supervision remain
  later tasks.
- Handoff baseline (`dcddec7`) differs from the task files' baseline
  (`77492b9`). Work continues from the checked-out task branch without
  destructive reconciliation.
- Handler invocation, delivery-backed cache, catch-up, read-side indexing,
  subscription updates, and system events are not implemented in this slice.
