# T-0026 Round 31 Fix Report

Status: verified
Branch: `task/T-0026-transport-backed-delivery-workers`
Worktree: `.worktrees/T-0026-transport-backed-delivery-workers`
Date: `2026-07-10`

## Canonical Skill Applicability Check

Checklist source: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Evidence gathered before edits:

| Source                                     | Scope                | Evidence                                                                                                          |
| ------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Session skill inventory                    | Task-relevant subset | Implementation, TDD, and verification skills were visible in-session and selected for this fix.                   |
| Task-provided requirements                 | Full Round 31 batch  | The assignment required no commit, no human-review edit, scoped ownership, log updates, red evidence, and checks. |
| `build-protocol/skills/EXPECTED_SKILLS.md` | Existing task record | Earlier T-0026 rounds already verified expected workflow/testing/type skills and local skill manifests.           |

Selected skills applied for this round:

| Skill                            | Round 31 use                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `test-driven-development`        | Confirmed the resume-cursor starvation regression failed before runtime code. |
| `implement`                      | Applied the narrow delivery-loop reliability and durable-log trace fixes.     |
| `verification-before-completion` | Recorded fresh required verification before reporting status.                 |

Project protocol, task scope, sandbox rules, and the explicit no-commit
instruction take precedence over advisory skill guidance.

## Round 31 Scope

Address every finding in the Round 31 batch:

1. Fix resume-cursor handling so a resumed zero-work drain cannot report `IDLE`
   while newly reachable supported work remains before a still-valid boundary.
2. Move shard pickup before resume-cursor validation so a shard live-owned by
   another worker returns `SKIPPED` before inbox boundary reads.
3. Qualify the stale Round 27 review-log finding with the final accounting
   contract for skipped/unsupported rows and pre-callback failures.
4. Ensure Round 30 verification records in task/work/review logs name fix
   commit `8a65e2b6` (`Polish delivery worker docs and fault fixture`).

## Red/Green Evidence

- Red: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts -t "rescans before going idle after a resumed zero-work drain"` failed before production edits.
- Red failure: the new regression returned `IDLE` with `delivered: 0` after a
  live-claimed supported head row became reachable while the saved boundary row
  at `offset - 1` remained valid.
- Green: the same focused regression passed after the delivery drain fix.
- Green: the focused Round 31 pair passed:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts -t "rescans before going idle after a resumed zero-work drain|skips a live-owned shard before validating a resume cursor"`; 2 tests passed.

## Implementation Summary

- `Delivery.#drain()` now picks up the shard before resolving an internal
  resume cursor, so a live-owned shard returns `SKIPPED` without inbox boundary
  validation reads.
- `Delivery.#drainAvailableMessages()` now performs one bounded head rescan
  when a resumed cursor reads zero pending rows after the cursor. This preserves
  finite scan behavior while preventing `IDLE` from hiding reachable supported
  work that became available before a still-valid boundary row.
- `delivery-loop.test.ts` covers both the resumed zero-work rescan and the
  shard-pickup-before-cursor-validation ordering.
- The Round 27 review-log finding now records the final contract:
  skipped/unsupported rows avoid failure-budget consumption, while
  pre-callback failures leave `accepted` unchanged but increment `failed` and
  count toward `DeliveryLoop.maxFailures`.
- The Round 30 verification trace now names commit `8a65e2b6` in the task,
  work, and review logs.

## Verification Commands and Results

- PASS: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/delivery-worker-runtime.test.ts packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts packages/server/test/index.test.ts`
  - 6 files passed, 232 tests passed.
- PASS: `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
  - `tsc -b` completed with exit code 0.
- PASS: `pnpm --config.verify-deps-before-run=false docs:check`
  - TypeDoc and API-doc expectation checks completed with exit code 0.
  - Reported only the existing invalid `origin` source-link warning.
- PASS: `pnpm --config.verify-deps-before-run=false format:check`
  - All matched files use Prettier code style.
- PASS: `git diff --check`
  - No whitespace or conflict-marker errors.

## Concerns

- `.codex-review-packages/` remains an existing untracked review scratch
  directory and was left untouched.
- The fix worker created no commit, per instruction.

## Coordinator Follow-up

- Coordinator inspection found the initial rescan fix only covered zero rows
  after the saved cursor. A resumed drain that processed skipped rows after the
  cursor could still return non-exhausted `IDLE` while reachable supported work
  remained before the cursor.
- The coordinator extended the regression so the resumed run appends a skipped
  tail row after the saved cursor before the head row becomes reachable, then
  tightened the drain to perform one bounded head rescan before any
  non-exhausted zero-accepted/zero-failed resumed finish.
- Coordinator verification at `2026-07-10T13:47:56Z` passed:
  - focused Round 31 pair, 1 file and 2 tests;
  - required focused delivery/API Vitest batch, 6 files and 232 tests;
  - `typecheck:build:generated`;
  - `docs:check`, with only the existing invalid `origin` warning;
  - `format:check`;
  - `git diff --check`.
- Fix commit: `a06e3749` (`Fix delivery resume cursor rescan`).
