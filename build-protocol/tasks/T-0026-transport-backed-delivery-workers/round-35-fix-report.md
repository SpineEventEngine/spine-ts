# T-0026 Round 35 Fix Report

Status: verified
Branch: `task/T-0026-transport-backed-delivery-workers`
Worktree: `.worktrees/T-0026-transport-backed-delivery-workers`
Date: `2026-07-10`

## Canonical Skill Applicability Check

Checklist source: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Evidence gathered before edits:

| Source                                     | Scope                | Evidence                                                                                                                           |
| ------------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Session skill inventory                    | Task-relevant subset | Implementation, TDD, TypeScript/backend, reliability, security, documentation, and verification skills were visible in-session.    |
| Task-provided requirements                 | Full Round 35 batch  | The assignment required durable trace cleanup, report formatting, expired-claim blocking, moving-set pagination repair, and tests. |
| `build-protocol/skills/EXPECTED_SKILLS.md` | Full file            | Expected workflow/testing/type skills were recorded and local fallback guidance was available.                                     |
| `~/.agents/skills/*/SKILL.md`              | Full directory list  | `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print` succeeded.                                           |
| `~/.agents/.skill-lock.json`               | Manifest opened      | Installed-skill lock manifest was readable and confirmed expected installed skill records.                                         |

Selected skills applied for this round:

| Skill                            | Round 35 use                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `test-driven-development`        | Add failing regressions before changing delivery claim and drain pagination behavior. |
| `implement`                      | Apply the scoped Round 35 batch against the existing task issue set.                  |
| `verification-before-completion` | Require fresh command evidence before reporting tests, formatting, and diff status.   |

Skipped or overridden relevant-looking skills:

| Skill                         | Reason Skipped or Overridden                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `requesting-code-review`      | The user requested a fix worker only; the orchestrator will run the next five-lane re-review after this report and verification. |
| `javascript-testing-patterns` | Existing Vitest delivery-worker and loop regressions cover this focused behavior change.                                         |
| `implement` commit guidance   | Overridden by the explicit Round 35 instruction: do not commit.                                                                  |

Project protocol, task scope, sandbox rules, and explicit human requirements
take precedence over advisory skill guidance.

## Round 35 Scope

Address every finding in the Round 35 batch:

1. Update Round 34 durable records and report wording to name fix commit
   `7a5378eb` (`Fix delivery tooling typecheck`).
2. Format `round-34-fix-report.md` so `format:check` passes.
3. Treat any existing inbox row claim as unavailable, including expired claims,
   until a future explicit abandoned-claim recovery policy exists.
4. Fix moving `TO_DELIVER` set pagination within one drain so skipped head rows
   disappearing between page reads cannot hide a later supported row.

## Intake Notes

- Before Round 35 edits, the worktree had existing uncommitted durable-log
  intake in `TASK.md`, `work-logs/T-0026.md`, and the T-0026 review log.
- `human-review-1-jul.md` and `.codex-review-packages/` are explicitly out of
  scope and were left untouched.

## Reproduction

- RED: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts -t "expired row claim|skipped head rows disappear"`
  - Failed before production edits with the intended behavior failures:
    expired claim handling invoked `signal-expired-claim`, and moving-offset
    pagination missed `signal-reachable-tail`.

## Implementation Notes

- `InboxStorage` no longer reclaims expired row claims. Any existing claim
  blocks delivery in this slice because the previous owner may still be inside
  `onMessage`; abandoned-claim recovery remains future explicit policy.
- `Delivery` now checks the pending boundary before reading an offset page. If
  skipped head rows disappeared and the boundary no longer matches, the drain
  resets to the head once and continues within the same finite scan budget
  instead of paging or idling past reachable work.
- Updated the expired-claim regression to assert no endpoint invocation and a
  still-pending row.
- Added a moving pending-set regression where a full skipped head page is
  completed by another owner between page reads while a supported tail remains
  reachable.
- Updated the Round 34 report to name fix commit `7a5378eb`
  (`Fix delivery tooling typecheck`) instead of saying no commit was created.
- Applied formatting to the Round 34 report.
- Coordinator refinement moved boundary validation before all offset-page reads,
  covering both empty and non-empty shifted pages, and updated public docs so
  expired and live per-message ownership both block competing delivery until a
  future explicit recovery policy exists. Historical correction: Round 43 /
  `9477830c` later superseded this no-reclaim rule by restoring expired-claim
  reclaim during claim CAS while live row claims block.

## Verification Commands and Results

- GREEN: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts -t "expired row claim|skipped head rows disappear"`
  - 1 file passed; 2 tests passed and 48 skipped.
- PASS: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/delivery-worker-runtime.test.ts packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
  - 5 files passed; 223 tests passed.
- PASS: `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
  - `tsc -b` completed with exit code 0.
- PASS: `pnpm --config.verify-deps-before-run=false docs:check`
  - Proto generation, TypeDoc, and API-doc expectation checks completed with
    exit code 0.
  - Reported only the existing invalid `origin` TypeDoc source-link warning.
- PASS: `pnpm --config.verify-deps-before-run=false format`
  - Formatter completed with exit code 0 and formatted the touched report/log
    files.
- PASS: `pnpm --config.verify-deps-before-run=false format:check`
  - All matched files use Prettier code style.
- PASS: `git diff --check`
  - No whitespace or conflict-marker errors.
- PASS: `git status --short`
  - No generated protobuf files are modified or untracked. Existing
    `.codex-review-packages/` scratch remains untracked and untouched.

## Coordinator Verification

- `2026-07-10T15:54:00Z`: Coordinator inspected the worker diff, tightened
  offset-boundary validation before all offset-page reads, updated public docs
  and the internal claim comment for no-reclaim semantics, and reran
  verification.
- PASS: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts -t "expired row claim|skipped head rows disappear"`
  - 1 file passed; 2 tests passed and 48 skipped.
- PASS: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/delivery-worker-runtime.test.ts packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
  - 5 files passed; 223 tests passed.
- PASS: `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
- PASS: `pnpm --config.verify-deps-before-run=false docs:check`
  - Reported only the existing invalid `origin` TypeDoc source-link warning.
- PASS: `pnpm --config.verify-deps-before-run=false format:check`
- PASS: `git diff --check`

## No-Commit Note

- The fix worker created no commit, per Round 35 instruction. Coordinator
  commit `5c3705e2` (`Fix delivery claim blocking and offset rescan`) later
  recorded the verified fix.
