# Implementation Report: T-0010.3 Write-Side Signal Intake Result

Status: Review Fix Complete
Task log:
`build-protocol/tasks/T-0010-3-write-side-signal-intake-result/TASK.md`
Work log: `build-protocol/work-logs/T-0010-3.md`
Review log:
`build-protocol/reviews/T-0010-3-write-side-signal-intake-result.md`
Branch: `task/T-0010-3-write-side-signal-intake-result`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0010-3-write-side-signal-intake-result`

## Summary

T-0010.3 starts from parent task commit `4d58ba8` after `T-0010.2` was merged
and verified. The selected work is a small write-side signal intake result
seam that preserves the distinction between accepted-for-async-work and
immediate intake failure without introducing buses, `Ack`, storage, dispatch,
delivery, services, or transport.

## JVM Research Used

Setup inspected Spine JVM `Bus.java`, `CommandBus.java`, and `EventBus.java`.
The JVM bus flow converts signals to envelopes, filters them, stores accepted
signals, acknowledges accepted signals before dispatch, and reports immediate
post-time failures as `Ack` statuses. Command ack monitoring and event
store-before-dispatch are explicitly larger than this subtask.

## Files Changed

- `packages/server/src/signal-intake.ts`
- `packages/server/src/signal-intake.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `packages/server/README.md`
- `docs/api/README.md`
- `scripts/check-api-docs.mjs`
- `build-protocol/tasks/T-0010-3-write-side-signal-intake-result/TASK.md`
- `build-protocol/tasks/T-0010-3-write-side-signal-intake-result/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0010-3.md`
- `build-protocol/reviews/T-0010-3-write-side-signal-intake-result.md`

## Implementation Notes

- Added immutable `SignalIntakeResult` values with a `status` discriminant,
  `signalKind` for command/event, accepted-for-async-work results, and
  immediate failure results.
- Added stable failure codes:
  `"RUNTIME_NOT_ACCEPTING"`, `"MALFORMED_ENVELOPE"`, and
  `"UNSUPPORTED_SIGNAL_KIND"`.
- Added copy-safe scalar diagnostics that omit payload-shaped keys such as
  `payload`, `message`, `signal`, and `envelope`.
- Exported the seam from `@spine-ts/server` and updated the TypeDoc export gate.
- Documented that accepted intake does not imply `Ack`, enqueueing, storage,
  dispatch, delivery, handling, services, validation, or transport behavior.

## Review-Fix Notes

- Documentation findings: updated `TASK.md` from stale pending-review wording to
  completed review-fix state, and added write-side signal intake result exports
  to the top `docs/api/README.md` current-status summary.
- Maintainability/API finding: removed the private
  `SignalIntakeDiagnosticInput` alias from the public `failSignalIntake()`
  signature by inlining `Readonly<Record<string, unknown>>`; no new public type
  or API export guard update was needed.
- Security findings: changed diagnostics sanitization from broad scalar copying
  with a payload-key denylist to a small allowlist of own enumerable data
  properties, skipped accessors without executing getters, and caught
  own-property descriptor inspection failures so hostile diagnostics collapse to
  empty sanitized metadata instead of making `failSignalIntake()` throw.

## Verification

- Setup baseline verification passed on `2026-06-30 16:35 WEST`:
  `CI=true corepack pnpm verify` passed with 18 test files / 224 tests,
  coverage 96.22% statements / 90.3% branches / 99.15% functions / 96.15%
  lines, TypeDoc/API checks with 100 proto / 28 core / 106 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.
- Red check on `2026-06-30 16:40 WEST`: `corepack pnpm exec vitest run
packages/server/src/signal-intake.test.ts` failed because
  `./signal-intake.js` did not exist.
- Focused green check on `2026-06-30 16:41 WEST`: `corepack pnpm exec vitest
run packages/server/src/signal-intake.test.ts` passed with 1 test file / 6
  tests.
- Focused export check on `2026-06-30 16:41 WEST`: `corepack pnpm exec vitest
run packages/server/src/signal-intake.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 15 tests.
- TypeScript check on `2026-06-30 16:42 WEST`: `corepack pnpm typecheck`
  passed.
- Lint/focused retry on `2026-06-30 16:44 WEST`: `corepack pnpm lint` passed
  and `corepack pnpm exec vitest run packages/server/src/signal-intake.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 15 tests.
- Final implementation verification on `2026-06-30 16:45 WEST`: `CI=true
corepack pnpm verify` passed with 19 test files / 230 tests, coverage 96.26%
  statements / 90.43% branches / 99.16% functions / 96.19% lines, TypeDoc/API
  checks with 100 proto / 28 core / 116 server / 26 storage expected exports,
  proto lint/generate checksum verification, and generated proto output clean.
- Review-fix RED check on `2026-06-30 16:52 WEST`: `corepack pnpm exec vitest
run packages/server/src/signal-intake.test.ts` failed with 1 test file / 3
  failed tests / 6 passed tests, proving the sanitizer leaked unknown scalar
  diagnostics, executed accessors, and let hostile proxy enumeration throw.
- Review-fix focused check on `2026-06-30 16:54 WEST`: `corepack pnpm exec
vitest run packages/server/src/signal-intake.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 18 tests.
- Review-fix full verification on `2026-06-30 16:57 WEST`: `CI=true corepack
pnpm verify` passed with 19 test files / 233 tests, coverage 96.28% statements
  / 90.35% branches / 99.16% functions / 96.21% lines, TypeDoc/API checks with
  100 proto / 28 core / 116 server / 26 storage expected exports, proto
  lint/generate checksum verification, and generated proto output clean.
