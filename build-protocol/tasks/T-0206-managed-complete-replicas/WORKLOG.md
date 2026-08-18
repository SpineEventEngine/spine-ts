# T-0206 work log

## 2026-08-18 — Framing and code map

- Fresh baseline is integrated `origin/main` at `ec9a382b9`; the protected
  primary checkout was not used for implementation.
- Current `Server.start()` is caller-managed; `Server.run()` adds process
  signal ownership through the private `ProcessServerCoordinator`.
  `RunningServer` exposes only host, port, URL, and close.
- No managed multi-process application implementation exists. Existing real
  process fixtures in server and Delivery provide bounded readiness,
  termination, and orphan-cleanup patterns but are not product supervisors.
- The implementation belongs in `server`, not `deployment`: `server` already
  depends on `deployment`, so the inverse import would create a cycle.
- The existing `RetryableCloseGroup`, `RunningHttp2Server` close ordering, and
  process signal coordinator are reusable lifecycle patterns. Delivery's
  reconnect backoff is evidence for bounded timers but is not reused as child
  restart policy because the ownership and healthy-reset semantics differ.
- Current built-server state is intentionally private. The task may add one
  immutable internal assembly report for manifest derivation rather than
  reflection or a new public control API.
- No conceptual blocker was found. Product implementation remains pending
  until this framing checkpoint is pushed.

## 2026-08-18 — Checkpoint A: validation RED/GREEN

- Implementation owner: existing `implementer` role, configured explicitly as
  `gpt-5.6-terra` / `medium` by the orchestrator. This execution surface does
  not expose runtime model telemetry, so the immutable dispatch profile is the
  available record. No subagents were used.
- Selected governing skill: `test-driven-development`, fully read before
  product changes. `systematic-debugging` was fully read after the first RED
  was blocked unexpectedly before test collection.
- JVM guardrail inspected: `spine-jvm-docs/spine-validation-storage-observability-and-support.md`,
  including its `ServerEnvironment` source mapping and process-wide semantic.
  This slice retains that local complete-server assembly model and adds no JVM-
  divergent application routing concept.
- The initial focused Vitest invocation failed before collection because fresh
  workspace package exports pointed to absent generated/build outputs. Root
  cause evidence: `packages/core/dist` was absent and direct `tsc -b` showed
  absent generated Proto imports. `pnpm proto:generate` plus
  `pnpm typecheck:build:generated` restored the normal test resolution path;
  this was a worktree prerequisite, not a product change.
- RED evidence retained: `pnpm exec vitest run
packages/server/test/server/managed-server-application.test.ts` then collected
  six tests and failed each with `ManagedServerApplication` undefined.
- GREEN evidence: the same command passed 6/6 after adding the smallest public
  validation boundary. It rejects missing, zero, negative, fractional,
  non-finite, and unsafe `processCount` values without CPU inspection.
- Checkpoint A remains in progress: topology, IPC, manifests, lifecycle policy,
  real-process fixtures, and public documentation are still pending.
