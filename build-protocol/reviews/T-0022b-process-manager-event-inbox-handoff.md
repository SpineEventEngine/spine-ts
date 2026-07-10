# Review Log: T-0022b Process-Manager Event Inbox Handoff

Status: final review clean; integrated to main with post-merge verification passed

Scope: live process-manager event reactor durable inbox handoff.

## Required Lanes

| Lane                       | Reviewer         | Status | Notes                                  |
| -------------------------- | ---------------- | ------ | -------------------------------------- |
| Code style/maintainability | latest: round 12 | clean  | Markdown and source style verified.    |
| Documentation completeness | latest: round 12 | clean  | Durable logs verified current.         |
| TypeScript/API docs        | latest: round 12 | clean  | No public API findings reported.       |
| Security                   | latest: round 12 | clean  | No new security findings reported.     |
| Performance/reliability    | latest: round 12 | clean  | Mixed duplicate coordination verified. |

## Planned Review Focus

- Confirm the implementation remains a narrow JVM-familiar process-manager
  endpoint handoff and does not become a generic delivery engine.
- Confirm tenant, payload, target type URL, and routed target ID validation
  happen before replaying handler code.
- Confirm process-manager command handoff, projection subscriber handoff, and
  current process-manager event semantics still pass.

## Round 1 Findings

### Code Style/Maintainability

- Important: `readProcessManagerInboxEvent()` duplicates the projection event
  reader and repeats the existing `fromBinary(...toBinary(...))` copy path.
  Consolidate the reader and use the generated Protobuf clone API where a copy
  is needed.
- Important: new process-manager event helper/test identifiers exceed the
  four-component naming rule. Shorten names while keeping intent clear.

### Documentation

- Important: `docs/api/README.md` still says process-manager event reactors and
  event-commanding handlers are invoked directly from the event bus.
- Minor: `build-protocol/DEVELOPER_API.md`, `packages/server/README.md`, and
  `docs/api/README.md` need to state that replay validates tenant, payload,
  target type URL, and routed target ID before handler code.
- Minor: task and review artifacts must be caught up from planned/pending to the
  implemented/reviewed state, and an implementation report should be added.

### TypeScript/API Docs

- Important: `docs/api/README.md` still describes old direct event-bus behavior.
- Minor: internal JSDoc for `ProcessManagerInboxTarget` and
  `ProcessManagerInbox` still says command-only even though both
  `HANDLE_COMMAND` and `REACT_UPON_EVENT` are now routed through the same
  internal target.

### Security

- Clean. The reviewer found row label, readable event envelope, payload type
  URL/schema validity, tenant metadata, target type URL, and routed target ID
  validation before handler code.

### Performance/Reliability

- Clean. The reviewer found exact-row replay, duplicate in-flight handoff reuse,
  retryable failed rows, delivered successful rows, and no generic scheduler or
  worker machinery added by this slice.

## Round 2 Findings

### Code Style/Maintainability

- Important: `validateProcessManagerReplayTenant` still violates the
  four-component naming rule. Shorten it before the style lane can pass.
- Clean on the rest of the round-one style scope: duplicated stored-event
  reader logic was consolidated, the `fromBinary(...toBinary(...))` copy path
  was removed from the new flow, and the implementation remains a narrow inbox
  handoff.

### Documentation

- Important: durable task chronology is impossible. Round-one fix work and the
  implementation report are dated before the task start and before round-one
  findings existed. Correct the timestamps.
- Minor: `IMPLEMENTATION_REPORT.md` omits `build-protocol/DECISION_LOG.md` and
  `packages/server/src/context/process-manager-handoff.ts` from its changed-file
  list.
- Clean on active content: docs no longer describe process-manager event
  handlers as direct `EventBus` execution, and they document `REACT_UPON_EVENT`
  plus pre-handler tenant, payload/schema, target type URL, and routed target ID
  validation.

### TypeScript/API Docs

- Clean. API docs and internal inbox JSDoc now match runtime behavior, no
  unnecessary public API was introduced, and generated reference docs were not
  edited as source.

### Security

- Clean. The reviewer found replay validation before handler code and no new
  execution or transport/IPC exposure. The reviewer noted no dedicated
  multitenant `REACT_UPON_EVENT` negative test, but verified the guard
  statically and did not classify it as a finding.

### Performance/Reliability

- High: process-manager event targets are handed off sequentially. If replay for
  an earlier routed target fails, later target rows may never be written to the
  durable inbox. This violates the JVM-style requirement that each routed target
  is sent to inbox storage first and leaves no retryable row for later targets.
- Add a regression for multi-target process-manager event routing where one
  target fails and another target is still durably queued or delivered.

## Round-Two Fix Follow-Up

- Author follow-up updated the remaining style helper name from
  `validateProcessManagerReplayTenant` to `validatePmReplayTenant`.
- Author follow-up added a focused regression in
  `packages/server/test/repository/repository-routing.test.ts` for a routed
  multi-target process-manager event where the first replay fails and the later
  target row remains durably queued.
- Author follow-up changed the multi-target process-manager event path to write
  all routed inbox rows before replaying them in order, keeping the current
  failure propagation while preserving retryable later rows.
- Author follow-up corrected the durable chronology in
  `build-protocol/work-logs/T-0022b.md` and expanded
  `IMPLEMENTATION_REPORT.md` to include the missing changed files.

## Round 3 Findings

### Code Style/Maintainability

- Important: the new test helper `createSplitRoutePmRepo` violates the
  four-component naming rule. Rename it before style can pass.

### Documentation

- Medium: the required-lanes summary table was stale and contradicted later
  round-two entries. Keep the table aligned with the latest lane status.

### TypeScript/API Docs

- Minor: internal process-manager inbox types are still widened to generic
  inbox input/message shapes. Narrow the internal compile-time contract for
  process-manager inbox rows so impossible labels/statuses are not accepted by
  TypeScript where the framework constructs these rows.

### Security

- Clean. The reviewer found the multi-target fix did not weaken fail-closed
  replay and did not introduce a public execution or transport surface.

### Performance/Reliability

- Clean. The reviewer verified that the multi-target path writes all routed rows
  before replay, keeps exact-row drain behavior, and that the new regression
  proves the fixed behavior.

## Round 4 Findings

### Code Style/Maintainability

- Clean. The reviewer found the helper rename and task-scope names compliant,
  and found the process-manager inbox type narrowing small and internal.

### Documentation

- Medium: work-log chronology was timestamp-sorted but still narratively
  inconsistent because the stalled-worker handoff said a replacement worker
  "will continue" after entries already recorded that worker's work.
- Minor: the implementation report still used stale round-two status wording.

### TypeScript/API Docs

- Minor: `ProcessManagerInboxMessage` narrowed labels but still inherited the
  broad inbox status union. Narrow replay messages to `TO_DELIVER`.

### Security

- Clean. The reviewer found latest fixes did not weaken pre-handler validation
  or introduce execution/transport/IPC surface.

### Performance/Reliability

- Clean. The reviewer found multi-target durability, exact-row replay, duplicate
  delivery, failure propagation, and retryability still sound.

## Round 5 Findings

### Code Style/Maintainability

- Medium: remove unused `fromBinary` and `toBinary` imports from
  `packages/server/src/repository/repository.ts`.
- Medium: remove unnecessary `async` from `SplitRouteProcessManager.reactTask()`.
- Medium: avoid the nested `expect.objectContaining(...)` matcher shape that
  triggers `@typescript-eslint/no-unsafe-assignment`.

### Documentation

- Medium: review-log status/table were stale and still showed round-three
  information.
- Medium: the work-log stalled-worker handoff wording still said a replacement
  worker "will continue" after the replacement worker entries.

### TypeScript/API Docs

- Clean. The reviewer found the internal PM inbox contract now narrows labels
  and status, with no public API creep or generated reference edits.

### Security

- Clean. The reviewer found latest fixes did not weaken fail-closed replay and
  did not introduce new execution/transport/IPC surface.

### Performance/Reliability

- Clean. The reviewer found multi-target PM event durability, exact-row replay,
  duplicate delivery, failure propagation, and retryability remain sound.

## Round 6 Findings

### Code Style/Maintainability

- Clean. The reviewer verified the unused imports, unnecessary `async`, and
  unsafe matcher findings were fixed.

### Documentation

- Medium: review-log status and required-lanes table still showed round-five
  findings as active after the round-five fixes were verified.

### TypeScript/API Docs

- Clean. The reviewer verified the internal process-manager inbox contract and
  public API surface.

### Security

- Clean. The reviewer found fail-closed replay and pre-handler validation still
  intact.

### Performance/Reliability

- High: `handoffPmEvents()` prewrote multi-target rows with a local version
  sequence starting at `1n` for each dispatch. Same-millisecond pending rows from
  different dispatches could retry in UUID order instead of enqueue order.
  Multi-target prewrite must use the local process-manager inbox version
  allocator.

## Round 7 Findings

### Code Style/Maintainability

- Clean. The reviewer did not report new naming, layout, or style findings.

### Documentation

- Medium: this review log still presented round-six status and findings as the
  current state after the round-six fix. Record round-seven findings and the
  current fix status accurately.

### TypeScript/API Docs

- Clean. The reviewer did not report new internal contract or public API doc
  findings.

### Security

- Clean. The reviewer did not report new security findings.

### Performance/Reliability

- High: `LocalProcessManagerInbox.receiveAll()` bypassed the in-flight handoff
  coordinator used by `receive()`. Concurrent duplicate multi-target
  process-manager event dispatches could deduplicate onto the same stored rows
  and then immediately attempt to drain while the original caller still owned
  the shard lease, causing a spurious skipped-delivery failure. Coordinate
  duplicate multi-target handoffs on a tenant-aware batch key while preserving
  write-all-before-drain behavior and the monotonic version allocator.

## Round 8 Findings

### Code Style/Maintainability

- Clean. The reviewer did not report new naming, layout, generated-output, or
  style findings.

### Documentation

- Medium: `build-protocol/work-logs/T-0022b.md` recorded round-seven review and
  fix entries before the round-six verification entry, making the durable
  chronology contradictory. Normalize the work-log timeline.

### TypeScript/API Docs

- Clean. The reviewer did not report new internal contract or public API doc
  findings.

### Security

- Clean. The reviewer did not report new security findings.

### Performance/Reliability

- Clean. The reviewer verified that duplicate `receiveAll()` calls are
  coordinated on a tenant-aware batch key, write-all-before-drain remains in
  place, version allocation still uses `#takeVersion()`, and the new concurrent
  duplicate multi-target regression is deterministic enough for this slice.

## Round-Eight Fix Follow-Up

- Author follow-up moved the round-seven work-log review/fix entries after the
  round-six verification entry and recorded the round-eight lane results here.

## Round 9 Findings

### Code Style/Maintainability

- Clean. The reviewer did not report new naming, layout, generated-output, or
  style findings.

### Documentation

- Medium: `build-protocol/work-logs/T-0022b.md` still presented round-seven
  fixes as the top-level current status after later review rounds. Bring the
  durable work-log status forward to the round-nine findings and fix state.
- Medium: `docs/architecture/README.md` still described the local delivery
  handoff as replayed command payloads only. Expand the architecture wording to
  cover command rows, projection subscriber rows, and process-manager event
  rows, including `REACT_UPON_EVENT` event payload, `signalId`, target metadata,
  exact-row replay, and pre-handler validation.

### TypeScript/API Docs

- Clean. The reviewer did not report new internal contract or public API doc
  findings.

### Security

- Clean. The reviewer did not report new security findings.

### Performance/Reliability

- High: `LocalProcessManagerInbox.receive()` and `receiveAll()` used separate
  coordination maps. A single-row duplicate could race with a row currently
  being drained by an in-flight batch, and a batch containing a single-row
  duplicate could race with the in-flight single-row drain. Register batch
  handoffs per row in the same coordination namespace used by `receive()`
  before writing rows, while keeping exact duplicate batch coordination,
  write-all-before-drain behavior, and `#takeVersion()` allocation.

## Round-Nine Fix Follow-Up

- Author follow-up added deterministic mixed duplicate regressions for
  batch-to-single and single-to-batch process-manager event handoffs.
- Author follow-up changed `LocalProcessManagerInbox.receiveAll()` to reserve
  per-row handoff promises in `#inFlightHandoffs` before writing batch rows.
  `receive()` now waits on matching in-flight batch rows, and `receiveAll()`
  waits on matching in-flight single rows while still reusing exact duplicate
  batch promises.
- Author follow-up kept batch writes ahead of owned-row drains and kept all row
  writes on the existing `#takeVersion()` allocator. Owned row promises resolve
  after their exact-row drain and reject/clean up on failure.
- Author follow-up updated the architecture README, work log, review log, and
  implementation report for the round-nine reliability/docs state.
- Author follow-up verification passed: the mixed duplicate red check failed
  before the fix and passed after it; focused Vitest, `lint:generated`,
  `docs:check`, and `git diff --check` all exited 0.

## Round 10 Findings

### Code Style/Maintainability

- Medium: `packages/server/src/context/process-manager-handoff.ts` declared
  supporting type aliases and interfaces before the primary
  `LocalProcessManagerInbox` class. Move supporting types below the class and
  keep them grouped before helper functions.

### Documentation

- Clean. The reviewer found durable logs current and chronological, source docs
  aligned with the process-manager event durable handoff, and no generated
  reference docs edited as source.

### TypeScript/API Docs

- Clean. The reviewer found the internal process-manager inbox contracts and
  public docs aligned with runtime behavior.

### Security

- Clean. The reviewer did not report new security findings.

### Performance/Reliability

- Clean. The reviewer found the process-manager inbox handoff reliable for
  single, batch, and mixed single-vs-batch duplicate paths.

## Round-Ten Fix Follow-Up

- Author follow-up moved `ProcessManagerInput`, `ProcessManagerInputs`,
  `ProcessManagerMessage`, `InboxDeferred`, and `BatchRow` below
  `LocalProcessManagerInbox` and before the helper functions.

## Round 11 Findings

### Code Style/Maintainability

- Medium: the review log required-lanes table and work-log verification entries
  contained lines longer than 120 characters. Reflow the notes and command
  evidence lines.

### Documentation

- Clean. The reviewer did not report documentation findings.

### TypeScript/API Docs

- Clean. The reviewer did not report TypeScript/API findings.

### Security

- Clean. The reviewer did not report security findings.

### Performance/Reliability

- Clean. The reviewer did not report performance/reliability findings.

## Round-Eleven Fix Follow-Up

- Author follow-up shortened the required-lanes note and wrapped long work-log
  command evidence lines.

## Round 12 Findings

- Clean across all required lanes: code style/maintainability, documentation,
  TypeScript/API docs, security, and performance/reliability.

## Final Verification Follow-Up

- Final full verification first exposed stale test typing in PM inbox negative
  tests and a branch coverage shortfall. Author follow-up kept the narrowed
  production PM inbox input type, made corrupted test inputs explicit, simplified
  an unreachable PM inbox branch, and added focused coverage for durable
  subscription record validation plus signal metadata optional/error paths.
- Escalated final `pnpm --config.verify-deps-before-run=false verify` passed
  with 1125 tests and 90.02% branch coverage.

## Final Review

- Clean across all required lanes: code style/maintainability, documentation,
  TypeScript/API docs, security, and performance/reliability.
