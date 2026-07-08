# T-0016f: Transport-Backed Local Runtime

Status: in progress
Start: `2026-07-08T13:37:58Z`
Baseline commit: `f86bd6a`
Branch: `task/T-0016f-local-runtime`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0016f-local-runtime`

## Objective

Make the existing command/event runtime routing plan executable through the
adapter-agnostic `SignalTransport` contract. Keep this slice local and small:
register command and event routes with a supplied transport, validate inbound
transport envelopes at the framework boundary, enqueue accepted work into the
server runtime, and keep ZeroMQ details adapter-private.

## Requirements

- Runtime routing must become executable for command and event routes over
  `SignalTransport`.
- ZeroMQ socket types, endpoint strings, multipart frame details, and native
  binding details must not appear in server public APIs.
- Transport behavior is same-host local IPC only. Endpoint naming, filesystem
  placement, and permissions remain adapter-owned and must not allow unintended
  remote access.
- Inbound transport signals must be validated before dispatching into
  command/event handlers or the runtime work queue.
- Runtime execution must remain asynchronous and must use the existing
  `SingleProcessServerRuntime` queue unless a smaller existing local seam is
  more appropriate.
- Keep the implementation JVM-familiar and intentionally narrower than JVM's
  full server environment and integration broker. Do not add a broad server
  lifecycle owner, production process supervisor, durable scheduler, or public
  ZeroMQ API in this task.
- Add at least one local multi-process or local IPC smoke test for the
  transport-backed runtime boundary. If the managed sandbox blocks local IPC,
  record the escalation requirement in the task and user-facing verification
  notes.
- Update runtime architecture docs, developer/API docs, package docs, task
  logs, and review logs.

## Spine JVM Inspection

Local JVM research docs inspected before implementation:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`
- `spine-jvm-docs/spine-validation-storage-observability-and-support.md`

Direct raw GitHub inspection of current `core-jvm` source was attempted for
`IntegrationBroker.java`, but escalated network access was rejected by the
environment policy. The local JVM docs remain the source for this slice.

Implementation impact:

- JVM `ServerEnvironment` owns process-level storage and transport factories.
  Spine TS should still prefer explicit runtime objects, but this task should
  not build the server/environment owner; that belongs to T-0016g.
- JVM bounded contexts own command/event buses and an `IntegrationBroker`.
  Transport-backed execution should enter the same framework dispatch surfaces
  rather than application code.
- JVM integration transport is adapter/factory based. Spine TS must keep
  transport details behind `SignalTransport` and must not leak ZeroMQ through
  server runtime APIs.
- JVM command dispatch is unicast and event dispatch is multicast. The TS
  executable routing should preserve command competing-consumer and event
  fan-out semantics already present in the routing plan.
- JVM server shutdown first stops externally visible containers and then closes
  contexts/resources. This task may create closeable runtime transport handles
  but must leave the public environment/server owner to T-0016g.

## Likely Files

- `packages/server/src/runtime`
- `packages/server/test/runtime`
- `packages/transport`
- `packages/transport/test/zeromq`
- `packages/server/src/index.ts`
- `packages/server/README.md`
- `packages/transport/README.md`
- `docs/api/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`

## Acceptance Criteria

- A framework-owned runtime binding registers command and event routes from
  `ServerRuntimeRoutingPlan` with a supplied `SignalTransport`.
- Registered command routes use request/respond semantics and registered event
  routes use publish/subscribe semantics matching the plan's subscription
  modes.
- Inbound command/event envelopes are checked for object shape and expected
  message type URL before any runtime work is enqueued.
- Accepted inbound signals are executed asynchronously through
  `SingleProcessServerRuntime`.
- The returned handle closes all registered transport handles and the runtime
  in a deterministic, idempotent order.
- ZeroMQ remains hidden behind `@spine-ts/transport`; server APIs expose only
  adapter-agnostic transport contracts.
- Focused tests cover registration, validation refusal, asynchronous execution,
  close ordering/idempotence, and at least one live local IPC smoke path.
- Public docs and TypeDoc/API docs describe the local-only transport-backed
  runtime boundary and sandbox escalation expectations for IPC tests.
- Required review lanes are clean: code style/maintainability, documentation,
  TypeScript/API docs, security, and performance/reliability.
- `corepack pnpm verify` passes, with any sandbox limitations recorded.

## Review Plan

After the implementation sub-agent reports completion, run five separate
reviewer sub-agents:

- code style/maintainability;
- documentation completeness;
- TypeScript/API docs;
- security;
- performance/reliability.

Feed every finding back to an implementation/fix sub-agent and repeat review
rounds until all lanes are clean.
