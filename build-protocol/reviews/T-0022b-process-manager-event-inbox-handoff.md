# Review Log: T-0022b Process-Manager Event Inbox Handoff

Status: round 3 completed; fixes required

Scope: live process-manager event reactor durable inbox handoff.

## Required Lanes

| Lane                       | Reviewer | Status  | Notes |
| -------------------------- | -------- | ------- | ----- |
| Code style/maintainability | latest: `019f4965-e9d3-7cf3-96ee-f2e67010cc61` | fixes required | Round-three test helper name violates four-component rule. |
| Documentation completeness | latest: `019f4966-0cd5-7822-aa2e-932b3922de03` | fixes required | Round-three table summary was stale. |
| TypeScript/API docs        | latest: `019f4966-30c9-7860-8a67-35fbc24b5be6` | fixes required | Round-three minor internal inbox type widening. |
| Security                   | latest: `019f4966-50a0-7270-9434-a3deadb01608` | clean | Tenant/payload/target validation still found before handler code. |
| Performance/reliability    | latest: `019f4966-75af-76d2-b11f-d19007f075ca` | clean | Round-two high multi-target durability finding verified fixed. |

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
