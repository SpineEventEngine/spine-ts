# Implementation Report: T-0012.7b Aggregate Storage And Signal Routing

Status: round-24 fixes verified
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

Round 4 requested documentation and reliability fixes. The task log and server
package README now reflect the implemented aggregate-storage/repository-routing
surface, and aggregate snapshot reads now fail closed when an internal snapshot
record has a missing or mismatched aggregate ID.

Verification after the round-4 fix:

- `corepack pnpm test packages/server/test/repository/aggregate-storage.test.ts`
  passed with 1 file and 10 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
  warning.

Round 5 requested final documentation/API/reliability fixes. The package README
no longer contradicts repository route calculation, task/work-log current state
now reflects the active final re-review phase, and snapshot identity validation
uses exact primitive equality so values such as `9` and `"9"` do not compare as
the same ID.

Verification after the round-5 fix:

- `corepack pnpm test packages/server/test/repository/aggregate-storage.test.ts`
  passed with 1 file and 10 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed.

Round 6 requested final documentation/API status fixes. The task/work-log
current state now reflects the active final re-review phase, and the package
README now states that routing calculation exists while runtime dispatch,
delivery, handler invocation, service hosting, and `Ack` behavior remain
deferred.

The round-6 docs-only fix was applied before round-7 re-review. Round 7
requested a fresh durable-status update plus aggregate-storage security and
reliability fixes. This fix pass addresses the new findings by rejecting
contradictory producer/payload event IDs, preserving exact primitive aggregate
identity without string coercion, requiring consecutive aggregate event
versions, validating snapshot state IDs against internal snapshot aggregate IDs,
and rejecting non-positive snapshot versions on write and read.

Verification after the round-7 fix pass:

- `corepack pnpm test packages/server/test/repository/aggregate-storage.test.ts`
  passed with 1 file and 15 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
  warning.

Round 8 requested one repository event-routing fix: the route path still
preferred producer ID over the event payload first-field ID when both were
present and contradictory. The fix keeps first-field fallback, accepts matching
producer/payload IDs, and rejects contradictory IDs before returning a route.

Round 9 requested a final stored-history reliability fix. Aggregate history now
rejects version gaps already present in storage, so corrupted histories such as
versions `1` and `3` fail closed before replay or later append attempts.

Verification after the round-9 fix pass:

- `corepack pnpm test packages/server/test/repository/aggregate-storage.test.ts packages/server/test/repository/repository-routing.test.ts`
  passed with 2 files and 20 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
  warning.
- `git diff --check` passed.

Round-20 fix commit: `2c70c67`. Round-21 re-review completed against
`.superpowers/sdd/review-083feaa..2c70c67.diff`.

Round 21 requested only status-log fixes. TypeScript/API docs, security, and
performance/reliability were clean; documentation and maintainability found
stale review/task/report status text after the round-20 commit.

Verification after the round-21 status fix:

- `corepack pnpm format:check` passed.
- `git diff --check` passed.

Round-21 status-fix commit: `45842a6`. Round-22 re-review completed against
`.superpowers/sdd/review-e2ad18d..45842a6.diff`.

Round 22 requested only status-log wording fixes. TypeScript/API docs and
security were clean; documentation, maintainability, and
performance/reliability found stale review-log status, stale in-progress
wording after round-21 verification, and completed re-review entries still
phrased as pending.

Verification after the round-22 status fix:

- `corepack pnpm format:check` passed.
- `git diff --check` passed.

Round-22 status-fix commit: `f613617`. Round-23 re-review completed against
`.superpowers/sdd/review-70f45d5..f613617.diff`.

Round 23 requested only status-log fixes. Security was clean; documentation,
maintainability, TypeScript/API docs, and performance/reliability found stale
round-22 pending text in the task file and out-of-order recent chronology in
this implementation report.

Verification after the round-23 status fix:

- `corepack pnpm format:check` passed.
- `git diff --check` passed.

Round-23 status-fix commit: `6c514df`. Round-24 re-review completed against
`.superpowers/sdd/review-3bb3945..6c514df.diff`.

Round 24 requested only status-log fixes. TypeScript/API docs and security were
clean; documentation, maintainability, and performance/reliability found stale
review-log current state, stale round-23 in-progress wording, and
implementation-report chronology that placed the round-23/24 setup before
round-21/22 entries.

Verification after the round-24 status fix:

- `corepack pnpm format:check` passed.
- `git diff --check` passed.
- The targeted stale-status phrase scan returned no matches.

Round-17 fix commit: `822d358`. Round-18 re-review completed against
`.superpowers/sdd/review-d7b9245..822d358.diff`.

Round 18 requested fixes for aggregate append handle lifetime, aggregate append
method size, an overlong verification command line, stale task/review/report
headers, EventBus ordering docs, storage-sharing wording, and the public
aggregate ID type contract. The fix constrains `AggregateStorage` IDs with the
exported primitive `AggregateId` type, keeps the runtime primitive-ID check for
JavaScript callers, splits append validation into small class-private methods,
guards the append event-store handle with `try/finally`, and updates public docs
to state the order later refined to `EventStore.acceptThenAppend()` around
dispatcher `accept()`, append, then `dispatch()`.

Verification after the round-18 fix pass:

- Focused storage event-store/factory/index, server bus/API, handler metadata,
  aggregate-storage, and repository-routing tests passed with 9 files and
  80 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
  warning and verified 135 expected `@spine-ts/server` exports.
- `git diff --check` passed.

Round-18 fix commit: `86b287e`. Round-19 re-review completed against
`.superpowers/sdd/review-7dbec34..86b287e.diff`.

Round 19 requested fixes for stale round-18/round-19 log text, missing
close-independent handle wording in architecture docs, the short EventBus README
summary, `bigint` in the public `AggregateId` type despite JSON snapshot
encoding, delayed `readHistory()` primitive-ID validation, whitespace event IDs
in stored aggregate history, and separate EventStore context snapshots between
EventBus precheck and append. The fix keeps `AggregateId` to
`string | number | boolean`, validates `readHistory()` IDs before storage
access, rejects whitespace event IDs when reading aggregate history, and adds
`EventStore.acceptThenAppend()` so EventBus precheck, dispatcher acceptance, and
append share one captured storage context.

Verification after the round-19 fix pass:

- Focused storage event-store/factory/index, server bus/API, handler metadata,
  aggregate-storage, and repository-routing tests passed with 9 files and
  83 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
  warning and verified 15 expected `@spine-ts/storage` exports.
- `git diff --check` passed.

Round-19 fix commit: `973a3f6`. Round-20 re-review completed against
`.superpowers/sdd/review-fc6c31d..973a3f6.diff`.

Round 20 requested fixes for stale review/task status text,
`acceptThenAppend()` wording in EventBus docs, and duplicate event IDs already
present in corrupted stored aggregate history. The fix updates source docs to
name `EventStore.acceptThenAppend()` for the combined precheck/accept/append
flow and rejects duplicate event IDs while reading aggregate history, before
`readHistory()` returns or `appendEvents()` can validate a later event.

Verification after the round-20 fix pass:

- Focused storage event-store/factory/index, server bus/API, handler metadata,
  aggregate-storage, and repository-routing tests passed with 9 files and
  84 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
  warning.
- `git diff --check` passed.

Round 10 requested a documentation/status cleanup and a reliability fix for
duplicate aggregate event IDs. The reliability fix rejects missing or duplicate
event IDs before `EventStore.appendAll()`, preventing replace-by-ID storage from
silently overwriting earlier aggregate history.

Verification after the round-10 fix pass:

- `corepack pnpm test packages/server/test/repository/aggregate-storage.test.ts packages/server/test/repository/repository-routing.test.ts`
  passed with 2 files and 21 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
  warning.
- `git diff --check` passed.

Round 11 requested event-store-wide duplicate event-ID validation plus final
status-doc cleanup. Aggregate append now checks incoming event IDs against the
whole event store, so a duplicate ID cannot overwrite another aggregate's event.

Verification after the round-11 fix pass:

- `corepack pnpm test packages/server/test/repository/aggregate-storage.test.ts packages/server/test/repository/repository-routing.test.ts`
  passed with 2 files and 22 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
  warning.
- `git diff --check` passed.

Round 12 requested final docs cleanup and an API-doc guard fix. The server
expected-export guard now checks TypeDoc JSON for `@spine-ts/server` names and
keeps the root-barrel check for root export drift.

Verification after the round-12 fix pass:

- `corepack pnpm test packages/server/test/repository/aggregate-storage.test.ts packages/server/test/repository/repository-routing.test.ts`
  passed with 2 files and 22 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
  warning.
- `git diff --check` passed.

Round 13 requested a more precise server TypeDoc module guard, serialized
aggregate append validation/write, and fail-closed handling for unreadable
producer IDs. The fix keeps these checks private to the existing storage,
repository, and docs guard seams.

Verification after the round-13 fix pass:

- `corepack pnpm test packages/server/test/repository/aggregate-storage.test.ts packages/server/test/repository/repository-routing.test.ts`
  passed with 2 files and 25 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
  warning.
- `git diff --check` passed.

Round 14 requested fixes for stale task-status wording, mutable append input
queued by reference, fabricated child handler records, repository event-route
validation happening after event storage, and duplicate event IDs across
multiple event-store instances sharing one backend. The fix keeps the changes
inside existing seams: `AggregateStorage` materializes append input at call
time, handler metadata now accepts only builder-created handler records,
`EventDispatcher.accept()` lets repository dispatchers validate before
`EventBus` appends, `EventStore` serializes uniqueness checks per
factory, context name, tenant mode, tenant ID, and `RecordSpec` instance, and
`InMemoryStorageFactory` gives each logical slice shared process-local records
through independently closeable storage handles.

Verification after the round-14 fix pass:

- `corepack pnpm test packages/storage/test/event/event-store.test.ts packages/storage/test/storage/storage-factory.test.ts packages/server/test/bus/event-bus.test.ts packages/server/test/bus/index.test.ts packages/server/test/handler/handler-metadata.test.ts packages/server/test/repository/aggregate-storage.test.ts packages/server/test/repository/repository-routing.test.ts`
  passed with 7 files and 56 tests.
- `corepack pnpm typecheck` passed.

Round 15 requested fixes for same-batch duplicate event IDs, mutable event
capture before queued append writes, cross-context in-memory storage
collisions, aggregate snapshot spec sharing, handler records reusable across
registration builders, custom dispatcher acceptance before repository
validation, stale public docs, storage TypeDoc guard drift, and stale durable
work/review logs. The fix keeps the behavior inside existing storage, bus,
repository, and handler metadata seams.

Verification after the round-15 fix pass:

- `corepack pnpm test packages/storage/test/event/event-store.test.ts packages/storage/test/storage/storage-factory.test.ts packages/storage/test/index.test.ts packages/server/test/bus/event-bus.test.ts packages/server/test/bus/index.test.ts packages/server/test/index.test.ts packages/server/test/handler/handler-metadata.test.ts packages/server/test/repository/aggregate-storage.test.ts packages/server/test/repository/repository-routing.test.ts`
  passed with 9 files and 74 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
  warning.
- `git diff --check` passed.

Round 16 requested fixes for cross-instance aggregate append races, temporary
event-store storage lifetime, in-memory tenant key collisions, blank event IDs,
storage adapter invariant TypeDoc, EventStore append TypeDoc, stale storage
guide wording, and stale work-log current state. The fix keeps aggregate
version serialization in `AggregateStorage`, keeps event-ID uniqueness in
`EventStore`, and keeps storage sharing semantics in the storage package.

Verification after the round-16 fix pass:

- `corepack pnpm test packages/storage/test/event/event-store.test.ts packages/storage/test/storage/storage-factory.test.ts packages/storage/test/index.test.ts packages/server/test/bus/event-bus.test.ts packages/server/test/bus/index.test.ts packages/server/test/index.test.ts packages/server/test/handler/handler-metadata.test.ts packages/server/test/repository/aggregate-storage.test.ts packages/server/test/repository/repository-routing.test.ts`
  passed with 9 files and 77 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
  warning.
- `git diff --check` passed.

Round 17 requested fixes for pre-validating event-store identity before
dispatcher `accept()`, avoiding construction-time aggregate tenant binding,
documenting close-independent storage handles, aligning storage sharing docs on
tenant mode and tenant ID, removing stale report text, rejecting whitespace
event IDs, and polishing EventStore TypeDoc.

Verification after the round-17 fix pass:

- Focused storage event-store/factory/index, server bus/API, handler metadata,
  aggregate-storage, and repository-routing tests passed with 9 files and
  80 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm format:check` passed after formatting
  `packages/server/src/repository/aggregate-storage.ts`.
- `corepack pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
  warning.
- `git diff --check` passed.

## Concerns

- Scope must stay within aggregate storage and signal routing. Delivery,
  `Inbox`, `Stand`, gRPC, import bus, scheduler, and process supervision remain
  later tasks.
- Handoff baseline (`dcddec7`) differs from the task files' baseline
  (`77492b9`). Work continues from the checked-out task branch without
  destructive reconciliation.
- Handler invocation, delivery-backed cache, catch-up, read-side indexing,
  subscription updates, and system events are not implemented in this slice.
