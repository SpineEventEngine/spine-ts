# T-0016f Review Log

Status: first-round findings fixed and verified

Scope: transport-backed local command/event runtime execution over
`SignalTransport`, local-only transport documentation, focused runtime tests,
and public docs.

Implementation note: this review-fix pass did not spawn reviewer sub-agents
because the request explicitly said not to spawn sub-agents.

## First-Round Findings

| Lane                    | Severity | Finding                                                                                                       | Fix status |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------- | ---------- |
| Performance/reliability | P1       | Runtime transport close had no binding-level closing gate while handle unregistration was in progress.        | Fixed      |
| Performance/reliability | P2       | A rejecting transport handle close skipped remaining handles and cached the rejected close promise.           | Fixed      |
| Security                | HIGH     | Inbound validation accepted hostile plain objects after shallow envelope/type URL checks.                     | Fixed      |
| Security                | MEDIUM   | Adapter behavior could still invoke command/event callbacks after close.                                      | Fixed      |
| TypeScript/API docs     | P2       | `RuntimeTransportBinding.open` TypeDoc missed local-only scope, validation-before-callbacks, and close order. | Fixed      |
| Documentation           | P1       | Architecture docs still listed transport-backed runtime execution as deferred.                                | Fixed      |
| Documentation           | P3       | Work log still said baseline verification was pending despite passed baseline/final verification.             | Fixed      |

## Fix Notes

- Added a binding-level intake gate that flips to closing before transport
  handle unregistration begins. Command/event accept paths refuse intake while
  the gate is closing or closed, even if an adapter invokes stale callbacks.
- Parsed accepted command/event envelopes through generated Protobuf binary
  encode/decode before runtime enqueue, so malformed generated shapes fail
  closed and accepted callbacks receive clean generated envelopes.
- Changed close to attempt every registered transport handle, close the runtime
  after transport handles, and clear a rejected close promise so later calls can
  retry failed handle cleanup.
- Updated `RuntimeTransportBinding.open` TypeDoc and architecture/work-log
  wording for the local-only boundary, validation behavior, and close order.

## Review-Fix Verification

- `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/runtime/runtime-transport.test.ts`:
  passed with 1 file and 11 tests.
- `pnpm --config.verify-deps-before-run=false typecheck`: passed.
- `pnpm --config.verify-deps-before-run=false lint`: passed.
- `pnpm --config.verify-deps-before-run=false format:check`: passed.
- `pnpm --config.verify-deps-before-run=false docs:check`: passed with the
  existing invalid-`origin` TypeDoc source-link warning.
- Sandboxed `pnpm --config.verify-deps-before-run=false verify`: failed only in
  local IPC/loopback tests with ZeroMQ `Operation not permitted` and
  `listen EPERM: operation not permitted 127.0.0.1`.
- Native `pnpm --config.verify-deps-before-run=false verify`: passed. Plain
  tests passed with 52 files and 871 tests; coverage passed with 94.78%
  statements, 90.04% branches, 97.70% functions, and 94.77% lines. TypeDoc
  completed with the existing invalid-`origin` source-link warning; API export
  checks, proto lint, and generated proto cleanliness passed.

## Required Lanes

| Lane                       | Reviewer sub-agent | Status    | Result                    |
| -------------------------- | ------------------ | --------- | ------------------------- |
| Code style/maintainability | pending            | Not rerun | Pending later review pass |
| Documentation completeness | prompt findings    | Fixed     | Pending later review pass |
| TypeScript/API docs        | prompt findings    | Fixed     | Pending later review pass |
| Security                   | prompt findings    | Fixed     | Pending later review pass |
| Performance/reliability    | prompt findings    | Fixed     | Pending later review pass |

## Review Policy

- All formal reviewer lanes must be run by separate sub-agents.
- Each participating sub-agent must be closed after its report is no longer
  needed.
- Any later finding must be fed back to an authoring/fix sub-agent and
  re-reviewed until clean before integration.
