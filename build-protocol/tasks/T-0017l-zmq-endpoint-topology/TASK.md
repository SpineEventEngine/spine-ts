# T-0017l: ZeroMQ Endpoint Topology And Worker Execution

Status: complete, pending integration
Started: `2026-07-09`
Branch: `task/T-0017l-zmq-endpoint-topology`
Worktree:
`.worktrees/T-0017l-zmq-endpoint-topology`
Base commit: `b53a3c3`

## Objective

Execute workers behind the transport abstraction using a local ZeroMQ IPC
endpoint topology without exposing ZeroMQ socket details through public
framework APIs.

## Scope

- Production parity/runtime completeness task after `T-0017k`.
- Keep public transport APIs adapter-neutral.
- Build on existing `SignalTransport`, `RuntimeTransportBinding`, and
  `ZeroMqAdapterConfig`.
- Add the smallest local IPC topology needed for workers to start, stop, and
  process command/event runtime traffic through the transport abstraction.
- Provide native/local IPC verification evidence or record an explicit blocker
  with the denied operation.
- Update docs/API docs and durable logs.

## Out Of Scope

- Remote TCP topology or multi-host transport.
- Public ZeroMQ socket classes, endpoints, multipart frames, or native binding
  types.
- Broad process supervision, health checks, broker cluster management, or
  retry/delivery policy beyond the runtime binding lifecycle.
- Command-log repositories, tracing backends, full system event taxonomy, or
  new storage adapters.
- Any end-user requirement to use framework `Event` envelopes, manual
  transactions, schema-bearing decorators, `@Apply`, or application-owned
  handler materialization.

## Human-Imposed Requirements Ledger

- Continue autonomously until all tasks are done or a real blocker appears.
- Keep `human-review-1-jul.md` untouched.
- Use this branch/worktree for this task.
- Spawn one implementation sub-agent for the task.
- Run independent reviewer sub-agents for code style/maintainability,
  documentation, TypeScript/API docs, security, and performance/reliability.
- Feed reviewer comments back to an authoring/fix sub-agent and repeat until
  all lanes are clean.
- Close every participating sub-agent once its role is complete.
- No change may be made without updating the relevant durable log.
- Server-module implementation requires close inspection of local Spine JVM
  docs and corresponding `core-jvm/server` sources when available before design
  or code changes.
- Prefer simpler JVM-familiar behavior over new abstractions.
- Native execution is explicitly allowed for local IPC/loopback listener tests.

## JVM Research Inputs

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, especially
  `IntegrationBroker`, transport/environment ownership, worker lifecycle, and
  local IPC constraints.
- Existing transport docs and implementation:
  `packages/transport/src/index.ts`,
  `packages/transport/src/zeromq/adapter-config.ts`,
  `packages/transport/test/zeromq/local-ipc-smoke.test.ts`, and
  `packages/transport/README.md`.
- Existing runtime binding implementation:
  `packages/server/src/runtime/runtime-transport.ts`,
  `packages/server/src/runtime/runtime-routing.ts`, and related tests.

## JVM Observations To Preserve

- Context integration uses shared transport instead of direct cross-context
  references.
- Transport is configured at runtime/environment level.
- Transport details are adapter-private; domain code and public framework APIs
  should stay transport-neutral.
- Event type production has ownership constraints, but this slice should avoid
  broad integration-broker ownership rules unless directly needed by the local
  worker topology.

## Proposed Shape

- Add a small ZeroMQ-backed `SignalTransport` implementation under
  `packages/transport/src/zeromq/`.
- Keep it out of the package root unless the exported API remains
  transport-neutral or clearly adapter-scoped.
- Use adapter config to derive local IPC endpoints deterministically.
- Add worker/runtime lifecycle tests that bind `RuntimeTransportBinding` to the
  ZeroMQ-backed transport using command/event routes or focused transport
  contract doubles.
- Keep worker start/stop idempotent and close sockets cleanly.

## Acceptance Criteria

- ZeroMQ endpoints are configured behind `SignalTransport` contracts.
- Workers can start, stop, and process runtime traffic through the transport
  abstraction.
- Public root APIs stay transport-neutral; ZeroMQ details remain
  adapter-private or adapter-scoped.
- Native/local IPC verification evidence is recorded.
- Docs describe the implemented topology honestly and keep broader production
  supervision/retry/cluster work deferred.

## Verification Plan

- Focused transport adapter tests.
- Runtime transport/worker lifecycle tests.
- Native/escalated ZeroMQ local IPC tests where required.
- `pnpm --config.verify-deps-before-run=false typecheck:build`.
- `pnpm --config.verify-deps-before-run=false format:check`.
- `pnpm --config.verify-deps-before-run=false docs:check`.
- `git diff --check`.
