# T-0016f Review Log

Status: all required lanes clean; final verification passed

Scope: transport-backed local command/event runtime execution over
`SignalTransport`, local-only transport documentation, focused runtime tests,
and public docs.

Review note: all required reviewer lanes were run by separate sub-agents. Each
participating implementation, fix, and reviewer sub-agent was closed after its
role was complete.

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

## Second-Round Findings

| Lane                    | Severity | Finding                                                                                                               | Fix status |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- | ---------- |
| TypeScript/API docs     | P2       | Rendered TypeDoc page for `RuntimeTransportBinding` did not show `open()` local-only, validation, and close ordering. | Fixed      |
| Performance/reliability | P2       | Retry after a failed binding close re-ran `close()` on transport handles that had already closed successfully.        | Fixed      |

## Final Re-Review

| Lane                       | Reviewer sub-agent                     | Status | Result                                                                                       |
| -------------------------- | -------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| Code style/maintainability | `019f422f-fb75-7a12-b0ab-33c5af46d853` | Clean  | Second-round style review reported clean.                                                    |
| Documentation completeness | `019f422f-fc2f-7511-aaa1-770750af2228` | Clean  | Second-round documentation review reported clean.                                            |
| TypeScript/API docs        | `019f423d-18ce-7b41-9648-fa643f98a4f6` | Clean  | Final TypeScript/API docs re-review reported clean after rendered TypeDoc wording was fixed. |
| Security                   | `019f422f-fd5d-7dc0-aeef-9af57906ce38` | Clean  | Second-round security review reported clean.                                                 |
| Performance/reliability    | `019f423d-195f-7332-b3d2-93927822659e` | Clean  | Final reliability re-review reported clean after per-handle close retry tracking was fixed.  |

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
- Duplicated the `open()` local-only, validation-before-callback-enqueue, and
  close-order wording onto the exported `RuntimeTransportBinding` TypeDoc
  comment so it renders on the binding page.
- Added binding-owned per-handle close success tracking. Retries now skip only
  handles that have already closed successfully, keep attempting all still
  pending handles in each pass, and keep the close gate in effect across
  failures.

## Review-Fix Verification

- Second-round red test:
  `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/runtime/runtime-transport.test.ts`
  failed before the production change because a non-idempotent already-closed
  event handle was closed twice.
- Second-round focused runtime transport:
  `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/runtime/runtime-transport.test.ts`
  passed with 1 file and 11 tests.
- `pnpm --config.verify-deps-before-run=false docs:check`: passed with the
  existing invalid-`origin` TypeDoc source-link warning. The generated
  `RuntimeTransportBinding` page contains the `same-host/local-only`,
  validation-before-enqueue, and close-order wording.
- `pnpm --config.verify-deps-before-run=false typecheck`: passed.
- `pnpm --config.verify-deps-before-run=false lint`: passed.
- `pnpm --config.verify-deps-before-run=false format:check`: passed after
  formatting the focused test helper.
- Sandboxed `pnpm --config.verify-deps-before-run=false verify`: failed only in
  local IPC/loopback tests with ZeroMQ `Operation not permitted` and
  `listen EPERM: operation not permitted 127.0.0.1`.
- Native `pnpm --config.verify-deps-before-run=false verify`: passed. Plain
  tests passed with 52 files and 871 tests; coverage passed with 94.78%
  statements, 90.05% branches, 97.70% functions, and 94.77% lines. TypeDoc
  completed with the existing invalid-`origin` source-link warning; API export
  checks, proto lint, and generated proto cleanliness passed.

## First-Round Review-Fix Verification

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

| Lane                       | Status | Result                                                                                                        |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| Code style/maintainability | Clean  | Required lane passed after the first implementation and the second-round re-review.                           |
| Documentation completeness | Clean  | Required lane passed after stale architecture and work-log wording was fixed.                                 |
| TypeScript/API docs        | Clean  | Required lane passed after rendered TypeDoc wording for `RuntimeTransportBinding` was fixed.                  |
| Security                   | Clean  | Required lane passed after generated-envelope parsing and the close intake gate were added.                   |
| Performance/reliability    | Clean  | Required lane passed after close gating, all-handle close attempts, and per-handle retry tracking were added. |

## Review Policy

- All formal reviewer lanes must be run by separate sub-agents.
- Each participating sub-agent must be closed after its report is no longer
  needed.
- Any later finding must be fed back to an authoring/fix sub-agent and
  re-reviewed until clean before integration.
