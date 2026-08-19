# T-0210 Work Log

## 2026-08-19 — initialization and contract inspection

- Started from `origin/main@bc45eae2008589daf50c9b668360ed6ea65d1e2a` in the
  supplied isolated worktree on `codex/t0210-external-replicas`.
- Role/profile: existing `implementer`, explicitly dispatched as
  `gpt-5.6-terra` / `medium`; runtime telemetry unavailable; no subagents.
- Read the T-0203 plan (complete-replica construction, external event path,
  RED 17–19/29, and T-0210 ownership), the Human Requirements Ledger, T-0204
  in-memory factory decision, Wave 13 broker/ThirdParty acceptance, and T-0208/
  T-0209 real managed Delivery fixtures.
- Confirmed the intended topology: each managed child builds both Bounded
  Contexts. Their broker exchange is process-local through the environment’s
  default in-memory `TransportFactory`; it is deliberately not an inter-process
  transport. The external receptor’s `LocalProjectionInbox` persists and
  drains through the normal `Delivery` interface.
- The prior Wave 13 cross-process test is explicitly not reused: it proves an
  obsolete ZeroMQ adapter and is forbidden for this acceptance.

## RED design

The new fixture will use the normal Todo `CommandService` as the domestic
producer, a separately generated external-receptor context in the same managed
child, the existing managed Coordinator subscription fan-out, and the
production `DeliveryAssembly`. A second case invokes `ThirdPartyContext` in
the same complete application assembly. No IPC frame contains an event or
other application payload; any fixture trigger is bounded local test control
only.

## 2026-08-19 — retained RED product defect

- The first fixture implementation reached the actual managed child context
  build. It failed before `READY`, while the consumer broker opened the
  event-type channel.
- `TaskCreatedSchema` correctly derives
  `type.spine.examples.todo/spine.examples.todo.TaskCreated`, because
  `examples/todo/proto/spine/examples/todo/task_events.proto` explicitly
  declares `option (type_url_prefix) = "type.spine.examples.todo"`.
- `InMemoryTransportFactory.copyChannel()` instead accepts only
  `type.spine.io` and `type.googleapis.com` prefixes. The broker therefore
  rejects the generated Todo domain Event before any fixture behavior runs.
- This is a real integration-transport defect: `TypeUrls.derive()` explicitly
  supports a non-empty, non-whitespace schema prefix, while the adapter rejects
  a valid generated schema URL. It is outside T-0210 fixture ownership and was
  returned to the orchestrator for a separately owned transport correction.
- Retained exact RED command:
  `pnpm exec vitest run packages/server/test/server/managed-external-events.integration.test.ts --pool=forks`.
  Both cases fail with `Message channel targetType must be a canonical type URL`
  from `packages/transport/src/memory/message-transport.ts` during
  `IntegrationBroker` opening.

## 2026-08-19 — Delivery cross-context root cause

- The repaired type URL adapter allowed the real process RED to reach normal
  broker import, external Event routing, remote Inbox persistence, and shard
  pickup. The imported Event and nested payload remain intact.
- The current environment creates a worker and long-lived supervisor per
  context runtime while the configured remote Delivery server exposes global
  shards. A `Tasks` supervisor receives the global update for an
  `ExternalTasks` projection row, picks the shard before endpoint filtering,
  then repeatedly scans and rejects that row. The `ExternalTasks` supervisor
  cannot acquire the shard. This is a bounded product defect, not a broker,
  codec, handler-metadata, or fixture failure.
- Approved correction: replace per-context competing pickup with one internal
  process-level shard owner/dispatcher. It dispatches after pickup using the
  registered endpoint label/type/shard, supports runtime join/leave and tenant
  scope, does not acknowledge unknown targets, and preserves close/drain.

## 2026-08-19 — shared remote dispatcher implementation

- Accepted reliability review batch received from the existing
  `performance_reliability_reviewer`, configured `gpt-5.6-terra` / `high`;
  runtime telemetry unavailable. It requires shared-supervisor stop quiescence,
  predicate admission for unmatched/tenant-mismatched rows, retirement fencing,
  and empty-group closure before acceptance.

- Added a focused RED where two remote-backed runtime endpoints share a shard:
  notifying the first after persisting the second endpoint's row left the
  rightful runtime unreached. The existing per-runtime supervisor ownership was
  the observed cause.
- Replaced remote per-runtime supervisors with one private supervisor group per
  shard cardinality. It retains endpoint route candidates by label, target type,
  and shard, dispatches known rows to the selected runtime callback, and removes
  only stopped/retired owner routes. Local/no-source supervisors remain
  owner-specific.
- Candidate route selection reads the existing imported/past-message Event
  tenant envelope and retains the selected runtime's tenant callback. A focused
  two-tenant test verifies equal endpoint keys do not overwrite one another.
- `pnpm typecheck:build:generated` passed. Focused environment worker tests:
  86 passing. The rebuilt managed domestic path (RED-17/18/29) passes.
- The managed ThirdParty fixture now registers `TaskCreatedSchema` in its
  environment type registry (removing the prior unsupported-schema crash), but
  RED-19 still times out after `ThirdPartyContext.emittedEvent()` resolves. The
  remaining failure is the fixture broker-interest lifecycle; it occurs after
  the dispatcher is no longer implicated and remains unresolved.

## 2026-08-19 — reliability correction convergence

- Retained new RED evidence: the shared supervisor consumed both an unknown
  endpoint row and a singleton tenant route with a nonmatching imported Event
  tenant. A selected owner whose finite worker stop failed also remained
  dispatchable through the shared group.
- The group now provides a private controlled-run admission predicate. It
  decodes only the existing Event import/past-message envelope and accepts a
  row only when a non-retiring route matches its endpoint and tenant, leaving
  all unmatched rows pending without invoking DeliveryMonitor failure policy.
- Owner stop fences fresh route admission. Retirement awaits that owner's
  admitted callbacks before removing its routes; a sibling retains its group,
  while retirement of the last owner closes and deletes it. Full worker stop
  closes the shared supervisor once after finite worker stop attempts and
  `awaitSettled()` includes its close.
- Focused evidence: environment delivery regressions pass 90/90, including
  unknown route pending, singleton tenant mismatch pending, blocked callback
  retirement, sibling-vs-last group close, and whole-worker stop behavior.
- The ThirdParty fixture creates its private broker before the managed process
  reports ready. This gives the existing online/wanted control exchange time to
  establish consumer interest before the test trigger; no product or wire
  contract changed. Managed acceptance passes 2/2, including two sequential
  domestic updates and ThirdParty import.
- Reviewer batch disposition: the accepted `performance_reliability_reviewer`
  (`gpt-5.6-terra`/`high`; runtime telemetry unavailable) findings on close
  quiescence, admission, tenant selection, retirement fencing, and empty-group
  closure are resolved by the focused regressions above. No new reviewer was
  dispatched in this continuation.

## 2026-08-19 — consolidated review correction

- Accepted consolidated findings: reliability review required Command-envelope
  tenant admission and an admission-to-owner-fence race proof; TypeScript/API
  review required removing the predicate from exported supervisor/delivery
  option surfaces. Review profiles: existing reliability and TypeScript/API
  reviewers, `gpt-5.6-terra`/`high`; runtime telemetry unavailable.
- The predicate is now installed only through the existing internal
  `deliverySupervisorAccess` seam. It is absent from root-exported
  `DeliverySupervisorOptions` and public `DeliveryRunOptions`.
- Route selection decodes Event origins first and Command actor-context tenants
  second. Admission reserves its selected owner route, so a concurrent owner
  fence cannot reselect the message into the default failure/acknowledgment
  path; retirement observes the reserved callback as active.
- Focused tooling typecheck and the environment worker suite pass after the
  correction. Remaining final changed-coverage and full mechanical gates are
  pending this continuation's final command budget.
- Added deterministic shared-remote `HANDLE_COMMAND` regressions: actor-context
  tenant match replays to the configured multitenant runtime; mismatch remains
  `TO_DELIVER`. Focused environment suite: 92 passing.
