# T-0209 Work Log

## 2026-08-19 — planning checkpoint

- Recorded the exact baseline `722a62b4704a5d910db22e7f9934bfd5535a151b`,
  high-risk lifecycle/concurrency classification, binding human requirements,
  owned paths, and T-0210 handoff before product changes.
- Reviewed the frozen T-0203 Delivery disposition and RED 22–28, D-0126,
  existing managed-server lifecycle/tests, and predecessor T-0206/T-0208
  records. No architecture re-plan is authorized or needed.
- Role record: existing `implementer`, explicit `gpt-5.6-terra` / `medium`.
  Runtime telemetry is unavailable. Subagents are prohibited and none were
  used. Accepted explorer record: `codebase explorer`, explicit
  `gpt-5.6-luna` / `low`, read-only/no subagents, telemetry unavailable.
- TDD skill was read completely before product work. The next action is to add
  the first narrow failing readiness/drain behavior test and capture its RED
  output before implementation.

## 2026-08-19 — superseded contract investigation

- `ManagedServerApplicationOptions` currently conveys only `createServer()` and
  opaque optional `synchronize()`. The child can report only an endpoint; it
  does not expose a Delivery facility, a strategy selection, or drain state.
- The existing `ServerEnvironment` can reveal a configured delivery object
  only after child assembly. Its public facility is merely closeable; its
  package-private structural `ServerEnvironmentDelivery` form can show ports
  and optional `source`, but cannot prove remote/shared identity. Existing
  `BoundedContextBuilder` snapshots a strategy and defaults it to one shard,
  losing whether the user explicitly selected it.
- Disposition from the controlling human directive: this is **not** a public
  contract blocker. Delivery and strategy provenance remain the application
  user's concern; runtime must not certify them. `Server.start()`/environment
  attachment already awaits openable Delivery `open()` (including
  `RemoteDelivery` initial snapshot) before `createServer()` resolves, and
  child-only `synchronize()` already installs retained subscriptions before
  READY. Fixtures supply the behavioral configuration and T-0211 will document
  it. Resume test-first implementation through the private lifecycle seam.

## 2026-08-19 — RED/GREEN: private DRAINING admission

- RED command: `pnpm exec vitest run
  packages/server/test/server/managed-server-application.test.ts
  --testNamePattern "removes a draining child"`. It failed as intended: after
  an authenticated private `draining` frame, Coordinator READY membership still
  contained the child (`1` received; `[]` expected).
- GREEN adds only a bounded `draining` slot/incarnation IPC frame. The child
  emits it before its existing `server.close()` chain; the parent removes that
  exact READY incarnation and marks its exit expected before listener/context
  delivery quiescence proceeds. The same focused command passed 1/1.
- This changes neither public API/wire nor Delivery lease/retry behavior. The
  next TDD cycle will establish real-child close ordering and direct remote
  Delivery readiness evidence.

## 2026-08-19 — focused regression evidence

- The initial full fixture run failed with EPIPE because real managed-child
  fixtures import `packages/server/dist` while the source-only test run had not
  rebuilt it. `pnpm typecheck:build:generated` refreshed the child module.
- The rebuilt run exposed two existing child-close tests which observed only one
  microtask. DRAINING is intentionally asynchronous IPC, so both now await the
  observable close call. This was a fixture timing correction, not a runtime
  retry/policy change.
- Final focused command: `pnpm exec vitest run
  packages/server/test/server/managed-server-application.test.ts`; **52/52
  passed**. The temporary Vite threads pool lacks `process.connected`, so the
  process-IPC signal assertion is valid only on the default fork-capable test
  profile used above.

## 2026-08-19 — remote supervisor regression

- Existing real-process remote suite passed **5/5**: `pnpm exec vitest run
  packages/delivery-client/test/remote-supervisor-grpc.integration.test.ts`.
  It reuses the accepted Delivery Server topology for direct Admin fan-out,
  exclusive fencing, snapshot recovery, and observation overflow.
- It is not counted as the required managed complete-replica acceptance: its
  child fixture assembles `ServerEnvironment` directly. RED 27–28 still need a
  managed-replica fixture with retained subscription behavior.
