# T-0211 work log

## 2026-08-19 — intake and ownership split

- Baseline fixed at `origin/main@f3a2d92b30537c8290dee2c963d079d4d2f978dc`.
- Classified high-risk because it changes deployable entrypoints and provider
  endpoint meaning, while preserving existing public and wire contracts.
- Read-only provider inventory used `gpt-5.6-luna` / `medium`; runtime telemetry
  unavailable and subagents prohibited. It confirmed GKE/GCE discovery already
  handles authoritative empty snapshots, scale changes, and stable identities,
  but currently describes ordinary application listeners rather than managed
  Coordinators.
- Read-only example inventory used `gpt-5.6-luna` / `medium`; runtime telemetry
  unavailable and subagents prohibited. It confirmed Message Board production
  examples still configure ZeroMQ and standalone application listeners, while
  Todo retains an obsolete ZeroMQ child-process fixture. Existing managed
  server acceptance supplies the replacement machinery.
- Work is split between non-overlapping provider and example lanes. The parent
  integration worktree remains coordination-only until both lanes are green.

## 2026-08-19 — runtime prerequisite: optional legacy signal transport

- Runtime lane assignment: existing `implementer` role, configured
  `gpt-5.6-terra` / `medium`; runtime telemetry unavailable and subagents
  prohibited.
- Retained RED: a Production `ServerEnvironment` configured with storage and a
  complete schema registry, but no generic `SignalTransport`, failed with
  `Production ServerEnvironment requires transport.` The managed external-event
  child could not use Production under that requirement.
- Minimal bridge: Production now requires only storage and the complete type
  registry. `transport` remains an optional legacy facility. `Server` creates
  and opens `ContextTransportGroup` only when that facility was explicitly
  supplied. Local/default and explicitly configured legacy transport behavior
  remain unchanged until T-0212 removes the subsystem.
- A real managed child now selects Production, supplies storage plus its
  complete event schema registry, and supplies no legacy signal transport. Its
  domestic and ThirdParty external-event paths still complete through the
  process-local broker and Delivery.

## 2026-08-19 — managed caller-owned lifecycle

- Provider review required the same lifecycle distinction already exposed by
  `Server`: `run()` owns process signals; `start()` leaves them to the caller.
  This is a public lifecycle correction, not another managed-process role.
- Retained RED: a coordinator selected for caller-owned startup still installed
  one extra `SIGINT` listener. The test also retains an unrelated listener
  registered during startup, so lifecycle teardown cannot remove listeners it
  does not own.
- `ManagedServerApplication.start(options)` now shares the existing validation,
  child behavior, replica startup, and Coordinator path with `run(options)`.
  It passes only an internal Coordinator signal-ownership flag. `run()` passes
  `true`; `start()` passes `false`; children are unchanged.
- Explicit caller close remains the existing idempotent/retryable coordinator
  close path. The process-owned `run()` proof verifies that it removes only its
  exact handlers and preserves an unrelated startup-time listener.

## 2026-08-19 — API review P1 documentation correction

- Review concern: `typescript_api_docs_reviewer`, configured
  `gpt-5.6-terra` / `high`; runtime telemetry unavailable. Disposition:
  accepted documentation-only P1.
- `packages/server/REFERENCE.md` and `RUNTIME_ARCHITECTURE.md` now state that
  Production requires `storageFactory` plus the complete `typeRegistry` only.
  The legacy `transport` setting is optional and opens its bindings only when
  explicitly supplied; the Production example omits it.
- The same references now distinguish `ManagedServerApplication.run()`
  (framework-owned `SIGINT`/`SIGTERM`) from `start()` (caller-owned signals and
  explicit handle close). No product code or public shape changed in this
  correction.
