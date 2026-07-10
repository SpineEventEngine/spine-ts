# Round 90 Fix Report

Timestamp: `2026-07-10T23:51:43Z`

## Findings

- Code style/maintainability: `ProjectionInbox.receive()` and
  `#receiveAndDrain()` repeat the same projection receive input object shape.
  The projection handoff should mirror process-manager handoff by deriving a
  local input alias from `Parameters<ProjectionInbox["receive"]>[1]`.
- Code style/maintainability: `ActiveClaim.#deliveredCallback` tracks callback
  success before delivery status update, so the field name should say callback
  success rather than delivered.
- Documentation: Round 88 report and review-log header still use the planning
  timestamp while verification evidence uses `2026-07-10T23:45:33Z`.

## Changes

- Derived `ProjectionInput` from `Parameters<ProjectionInbox["receive"]>[1]`
  and reused it for both `ProjectionInbox.receive()` and `#receiveAndDrain()`.
- Renamed `ActiveClaim.#deliveredCallback` to `#callbackSucceeded` so the flag
  matches when it is set by `markCallbackSucceeded()`.
- Aligned the Round 88 fix report timestamp and review-log Round 88 header with
  the actual `2026-07-10T23:45:33Z` verification timestamp.

## Verification

- `2026-07-10T23:55:22Z`: focused projection/delivery Vitest passed with 3
  files and 90 tests.
- `2026-07-10T23:55:22Z`: `typecheck:build:generated` passed.
- `2026-07-10T23:55:22Z`: `docs:check` passed with only the existing invalid
  TypeDoc `origin` warning.
- `2026-07-10T23:55:22Z`: `format:check` passed.
- `2026-07-10T23:55:22Z`: the targeted command-continuation search returned no
  matches.
- `2026-07-10T23:55:22Z`: `git diff --check` passed.
- `2026-07-10T23:55:22Z`: generated/API reference diff checks returned no
  changed files.
