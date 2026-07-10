# T-0026 Round 44 Fix Report

Status: committed; records-only status committed; re-review pending
Date: `2026-07-10`

Branch: `task/T-0026-transport-backed-delivery-workers`
Worktree: `.worktrees/T-0026-transport-backed-delivery-workers`
Worker commit: none; fix coordinator commit `9bb68f33`; records-only status
coordinator commit `52a4326d`.

## Skill Applicability

Canonical checklist source: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

| Source                  | Evidence                                                                                                                    | Result                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Session inventory       | The Codex session exposed workflow, testing, TypeScript, backend, docs, security, review, and verification skills.          | Task-relevant subset triaged.                            |
| Task-provided skills    | The prompt required `/Users/armiol/.agents/skills/test-driven-development/SKILL.md`.                                        | Fully read before behavior edits.                        |
| Expected-skill manifest | Read `build-protocol/skills/EXPECTED_SKILLS.md`.                                                                            | Expected workflow/backend skills are locally installed.  |
| Installed entrypoints   | `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print` succeeded over the full user skill directory. | Metadata triaged without reading unrelated skill bodies. |
| Installed-skill lock    | Read `/Users/armiol/.agents/.skill-lock.json`.                                                                              | Readable; confirms expected source paths.                |

Selected skill:

| Skill                     | Source             | Why selected                                 | Applied instruction                                                              |
| ------------------------- | ------------------ | -------------------------------------------- | -------------------------------------------------------------------------------- |
| `test-driven-development` | User-provided path | Required for projection replay behavior fix. | Added focused failing regression before changing projection replay status guard. |

Skipped relevant-looking skills: `javascript-testing-patterns` because the
user-provided TDD workflow governed the focused Vitest regression,
`projection-patterns` because this fix only closes replay validation and does
not redesign projection catch-up semantics, and `security-best-practices`
because the security finding was a narrow fail-closed validation bug already
covered by project rules.

Project protocol, task ledger, and the user prompt take precedence over skill
advice.

## Findings Addressed

- Removed the internal `DeliveryOptions.leaseMs` mention from the root-public
  delivery error-contract sentence in `build-protocol/DEVELOPER_API.md`; the
  public sentence now names only `ShardedWorkRegistryOptions.leaseMs`.
- Added a fail-closed `TO_DELIVER` status guard to
  `LocalProjectionInbox.replay()` before projection target lookup and
  repository/user projection invocation.
- Added focused regression coverage proving `DELIVERED`, `SCHEDULED`, and
  `TO_CATCH_UP` projection replay snapshots reject before projection handlers
  run.
- Updated stale Round 24, Round 25, Round 37, task, work, and review records so
  Round 35 / `5c3705e2` is recorded as the temporary no-reclaim contract and
  Round 43 / `9477830c` is recorded as the later restoration of expired-claim
  reclaim during claim CAS while live claims block.

## Red/Green Evidence

- RED: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/context/projection-handoff.test.ts -t "rejects non-pending replay"`
  failed before the production guard because `LocalProjectionInbox.replay()`
  resolved for a non-pending snapshot instead of rejecting.
- GREEN: the same focused command passed after projection replay asserted
  `TO_DELIVER` status before invoking the registered target.
- Focused context handoff batch passed:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/context/projection-handoff.test.ts packages/server/test/context/process-manager-handoff.test.ts`;
  2 files, 22 tests.

## Files Changed

- `build-protocol/DEVELOPER_API.md`
- `build-protocol/reviews/T-0026-transport-backed-delivery-workers.md`
- `build-protocol/tasks/T-0026-transport-backed-delivery-workers/TASK.md`
- `build-protocol/tasks/T-0026-transport-backed-delivery-workers/round-24-fix-report.md`
- `build-protocol/tasks/T-0026-transport-backed-delivery-workers/round-25-fix-report.md`
- `build-protocol/tasks/T-0026-transport-backed-delivery-workers/round-37-fix-report.md`
- `build-protocol/tasks/T-0026-transport-backed-delivery-workers/round-44-fix-report.md`
- `build-protocol/work-logs/T-0026.md`
- `packages/server/src/context/projection-handoff.ts`
- `packages/server/test/context/projection-handoff.test.ts`

## Verification

- Passed focused projection replay red/green command as described above.
- Passed focused context handoff Vitest: 2 files, 22 tests.
- Passed `pnpm --config.verify-deps-before-run=false typecheck:build:generated`.
- Passed `pnpm --config.verify-deps-before-run=false docs:check`; TypeDoc kept
  the existing invalid-`origin` source-link warning and reported the expected
  API export counts.
- Passed `pnpm --config.verify-deps-before-run=false lint`.
- Ran `pnpm --config.verify-deps-before-run=false format` after the first
  `format:check` reported wrapping needed in the T-0026 review log.
- Passed final `pnpm --config.verify-deps-before-run=false format:check`.
- Passed `git diff --check`.
- Passed `git diff --check ca8fb2b3..HEAD`.
- Coordinator verification after the worker returned also passed focused
  context handoff Vitest with 2 files and 22 tests, generated build typecheck,
  docs check with only the existing invalid-`origin` warning, lint, format
  check, working-tree diff check, and baseline range diff check.

## Commit

No worker commit was created. Coordinator commit `9bb68f33` (`Fix projection replay status guard`) recorded this fix. Records-only coordinator commit
`52a4326d` (`Record delivery round 44 review status`) recorded the follow-up
status package.
