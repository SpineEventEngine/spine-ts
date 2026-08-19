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
