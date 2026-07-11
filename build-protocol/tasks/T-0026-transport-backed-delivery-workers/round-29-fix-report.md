# T-0026 Round 29 Fix Report

Status: verified
Branch: `task/T-0026-transport-backed-delivery-workers`
Worktree: `.worktrees/T-0026-transport-backed-delivery-workers`
Date: `2026-07-10`

## Canonical Skill Applicability Check

Checklist source: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Evidence gathered before edits:

| Source                                     | Scope                | Evidence                                                                                                      |
| ------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------- |
| Session skill inventory                    | Task-relevant subset | Implementation, TDD, review-feedback, TypeScript/testing, and verification skills were visible.               |
| Task-provided requirements                 | Full Round 29 batch  | The assignment required red evidence, no commit, log updates, focused verification, and no human-review edit. |
| `build-protocol/skills/EXPECTED_SKILLS.md` | Existing task record | Earlier T-0026 rounds already verified expected workflow/testing/type skills and local skill manifests.       |

Selected skills applied for this round:

| Skill                            | Round 29 use                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `test-driven-development`        | Confirmed the mixed fail/success loop regression failed before production edits.                   |
| `implement`                      | Applied the narrow delivery-loop, internal-drain, fixture, and durable-doc fixes.                  |
| `receiving-code-review`          | Treated Round 29 findings as review feedback and verified them against code before changing seams. |
| `verification-before-completion` | Will record fresh focused and required verification before reporting completion.                   |

Project protocol, task scope, sandbox rules, and the explicit no-commit instruction take precedence over advisory skill guidance.

## Round 29 Scope

Address every finding in the Round 29 batch:

1. Fix mixed success/failure loop drains so a cursor cannot strand a retryable failed row behind later delivered work.
2. Replace the implicit `DeliveryRun` WeakMap metadata side channel with an explicit package-local internal drain outcome for `DeliveryLoop`.
3. Narrow the delivery storage fault fixture into scenario-focused probes/helpers and remove the long flag-driven compare-and-set chain.
4. Correct stale Round 27 documentation/log wording so only skipped unsupported rows avoid loop failure-budget consumption.

## Red/Green Evidence

- Red: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts -t "retries a failed head row before going idle after a later success"` failed before production edits.
- Red failure: the new mixed fail/success regression attempted `["signal-fails", "signal-succeeds"]` instead of retrying `signal-fails` before going idle, proving the saved resume cursor advanced past the retryable row.
- Green: the same focused command passed after the loop/internal-drain fix with 1 passing test and 22 skipped tests.
- Green: focused delivery worker/loop/runtime coverage passed after the fixture refactor:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-worker-runtime.test.ts`
  - 3 files passed, 77 tests passed.

## Implementation Summary

- `Delivery.drain()` still returns the public `DeliveryRun`, while the package-local `deliveryAccess.drain()` now returns an explicit internal outcome containing `{ run, resumeCursor, exhaustedSkippedScan }`.
- `DeliveryLoop` now consumes the explicit internal outcome and uses `exhaustedSkippedScan` instead of reconstructing scan exhaustion from public counters. Failed drain outcomes omit `resumeCursor`, which prevents persisted cursor state from advancing past retryable failed rows.
- Removed the `DeliveryRun` WeakMap metadata side channel used for loop resume state.
- Refactored `delivery-storage-fault-fixture.ts` around named probes such as blocked inbox claim/renewal, throwing claim/clear/finalize, skipped clear/repair/finalize, and inbox-read hooks. Tests now compose probes through `deliveryStorageFaults(...)` instead of mutating a broad exported plan object.
- Corrected stale Round 27 text in the historical fix report and work log as understood in Round 29. Round 106 correction: skipped unsupported rows avoid failure-budget consumption; pre-callback claim, validation, and lease failures leave `accepted` unchanged but increment `failed` and count toward `DeliveryLoop.maxFailures`; post-callback cleanup/status-update failures are accepted work and may appear in failed work.

## Verification Commands and Results

- PASS: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/delivery-worker-runtime.test.ts packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts packages/server/test/index.test.ts`
  - 6 files passed, 230 tests passed.
- PASS: `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
  - `tsc -b` completed with exit code 0.
- PASS: `pnpm --config.verify-deps-before-run=false docs:check`
  - TypeDoc and API-doc expectation checks completed with exit code 0.
  - Reported only the existing invalid `origin` source-link warning.
- PASS: `pnpm --config.verify-deps-before-run=false format:check`
  - All matched files use Prettier code style.
- PASS: `git diff --check`
  - No whitespace or conflict-marker errors.

## Coordinator Verification

- `2026-07-10T13:14:12Z`: Coordinator reran the focused delivery/API Vitest
  batch after inspecting the worker diff.
  - PASS: 6 files passed, 230 tests passed.
- PASS: `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
- PASS: `pnpm --config.verify-deps-before-run=false docs:check`
  - Reported only the existing invalid `origin` source-link warning.
- PASS: `pnpm --config.verify-deps-before-run=false format:check`
- PASS: `git diff --check`

## Concerns

- `.codex-review-packages/` remains an existing untracked review scratch directory and was left untouched.
- The fix worker created no commit; coordinator commit `fd563047`
  (`Fix delivery drain resume outcome`) later recorded this verified fix.
