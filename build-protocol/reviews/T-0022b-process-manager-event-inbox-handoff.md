# Review Log: T-0022b Process-Manager Event Inbox Handoff

Status: round 1 completed; fixes required

Scope: live process-manager event reactor durable inbox handoff.

## Required Lanes

| Lane                       | Reviewer | Status  | Notes |
| -------------------------- | -------- | ------- | ----- |
| Code style/maintainability | `019f4947-110f-7773-b40b-56a90982b0ad` | fixes required | Duplicate event inbox reader and overlong names. |
| Documentation completeness | `019f4947-439d-7931-a16d-301eccbf0ed3` | fixes required | Stale direct-EventBus prose and missing safety contract/status docs. |
| TypeScript/API docs        | `019f4947-5f0f-7252-9b3f-34dafd99a7db` | fixes required | Stale API README prose and internal JSDoc. |
| Security                   | `019f4947-7a60-7110-8578-01e9c530019e` | clean | Tenant/payload/target validation found before handler code. |
| Performance/reliability    | `019f4947-9c96-7540-8d5b-7e91edb49c19` | clean | Exact-row replay and duplicate handoff behavior found sound. |

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
