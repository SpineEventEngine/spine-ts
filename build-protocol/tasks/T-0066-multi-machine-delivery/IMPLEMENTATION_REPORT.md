# T-0066 Implementation Report

Status: accepted; awaiting commit and integration.

## Implemented topology

- A parent Vitest process starts the standalone in-memory delivery server on an
  ephemeral trusted-loopback port.
- Two independent Node applications use package-root delivery APIs, a local
  disposable quarantine, generated command payloads, and generated Admin/health
  descriptors.
- The focused scenario proves exclusive direct pickup/release, ordinary alpha
  and beta dispatch, killed-owner stale takeover after the deliberate 500 ms
  quiet interval, and a fresh supervisor dispatching a final command.
- Event-driven Admin barriers prove the exact `2 + 4 + 4 + 6 + 4` transition
  model, exactly 20 update frames after the ACK, and a final `NOT_PICKED/0`
  public snapshot.
- Generated health checks prove overall and known-service `SERVING`, unknown
  service `NOT_SERVING`, and terminal transport unavailability after shutdown.
- A deliberate post-readiness primary failure proves both applications and the
  server exit, the Admin stream terminates, and the listener port is reusable.
  Cleanup preserves the primary error and aggregates cleanup failures.
- IPC accepts only bounded command/result shapes and returns sanitized failure
  diagnostics.
- One-second child readiness and request gates reject on timeout, exit,
  disconnect, process error, or send failure and remove all listeners/timers at
  settlement. `write` alone requires a bounded signal ID; every other command
  rejects one.
- Child control frames use exact key sets, and parent commands use a
  discriminated object shape. Exit waiting owns one cancelable timeout/event
  settlement rather than retaining a losing event promise.
- The principal success path owns cleanup in `finally`, and Admin collection is
  capped at exactly the ACK plus 20 updates.

## Runtime defect and correction

The first exact-count RED consistently observed an extra empty
`PICKED/0 -> NOT_PICKED/0` cycle after stale takeover. No production file was
changed in this packet. The separately reviewed correction `d6a5921b`, closed
and integrated by `6d35cc98`, prevents zero-message controlled delivery runs.
The corrected `main` was back-merged without conflicts and received a clean
eight-check integrity review before this suite resumed.

## Evidence

- RED: absent fixture import failed as expected.
- GREEN: generated-build and tooling typechecks.
- GREEN twice: the final three-test native e2e suite, with the approved
  local-loopback execution surface required because the sandbox rejects
  `listen()`.
- GREEN twice on the final exact source after re-review corrections: 1 file / 3
  tests in 5.07 seconds and 5.00 seconds, including timeout, eventual exit, child exit,
  child error, disconnect, and send-callback failure with zero retained
  coordination listeners/timers.
- GREEN: touched ESLint, Prettier, cleanup rules, package-root import scan, and
  `git diff --check`.
- GREEN: full repository `verify` passed with 127 test files passing, 3 skipped,
  2,317 tests passing, 21 skipped, and 90.09% branch coverage. API docs, Proto
  integrity, generated-output cleanliness, and release readiness also passed.

## Review corrections

The complete reliability/style/documentation wave produced eight accepted
P1/P2 findings. One consolidated implementation batch closed all eight without
production expansion. A behavior test injects a deterministic cleanup failure
and proves the primary error remains first, later cleanup still runs, resources
terminate, and the listener port remains reusable. The final focused suite now
contains three tests.

Affected re-review lanes: performance/reliability, style/maintainability, and
documentation.

The final batch additionally tightened exact IPC keys, removed the uncancelled
exit-race loser, made settlement branch coverage deterministic, and changed the
README clean-checkout prerequisite to composite `typecheck:build` so Proto
generation precedes generated-source checking.

The final reliability re-review found one narrower registration race after the
initial terminal-state check. `settledExit` now rechecks terminal state
immediately after installing exit/error listeners and settles through its
idempotent cleanup path. A deterministic induced-race test proves no false
timeout and no retained listeners/timer. The corrected native suite passed
twice at 1 file / 3 tests (5.12 seconds and 5.07 seconds). Only
performance/reliability requires final focused re-review; style/maintainability
and documentation remain accepted.

## Limits

The server is in-memory and trusted-loopback only. This is TS-to-TS proof;
live JVM interoperability remains deferred to Wave 3. The production defect
discovered by this suite was corrected and closed separately; no unresolved
production or public-contract defect remains.
