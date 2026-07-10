# Review Log: T-0022b Process-Manager Event Inbox Handoff

Status: round 5 completed; fixes required

Scope: live process-manager event reactor durable inbox handoff.

## Required Lanes

| Lane                       | Reviewer | Status  | Notes |
| -------------------------- | -------- | ------- | ----- |
| Code style/maintainability | latest: `019f4976-eb21-71c0-97ff-e0ef1fb34029` | fixes required | Round-five lint/style cleanup required. |
| Documentation completeness | latest: `019f4977-11e3-7831-839a-0d89709c5826` | fixes required | Round-five review-log status and handoff wording stale. |
| TypeScript/API docs        | latest: `019f4977-3a04-7db0-afed-2b8dbdf2487e` | clean | PM inbox label/status narrowing verified. |
| Security                   | latest: `019f4977-596f-7093-a008-a4b6fa61f3fa` | clean | Fail-closed replay still verified. |
| Performance/reliability    | latest: `019f4977-7c38-7433-91e2-64351e4a0a74` | clean | Multi-target durability remains verified. |

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
