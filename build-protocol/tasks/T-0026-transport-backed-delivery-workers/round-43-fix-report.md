# T-0026 Round 43 Fix Report

Status: fixes verified; coordinator commit pending

Branch: `task/T-0026-transport-backed-delivery-workers`
Worktree: `.worktrees/T-0026-transport-backed-delivery-workers`
Worker commit: none; coordinator commit pending.

## Skill Applicability

Canonical checklist source: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

| Checklist item           | Evidence                                                                                                                    | Result                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Session inventory        | The Codex session exposed workflow, testing, TypeScript, backend, docs, security, review, and verification skills.          | Task-relevant subset triaged.                                    |
| Task-provided skills     | User required `/Users/armiol/.agents/skills/test-driven-development/SKILL.md`.                                              | Fully read before behavior edits.                                |
| Expected-skill manifest  | Read `build-protocol/skills/EXPECTED_SKILLS.md`.                                                                            | Expected workflow/backend skills are locally installed.          |
| Installed entrypoints    | `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print` succeeded over the full user skill directory. | Metadata triaged without reading unrelated skill bodies.         |
| Installed-skill manifest | Read `/Users/armiol/.agents/.skill-lock.json`.                                                                              | Readable; confirms expected source repositories and local paths. |

Selected skill:

| Skill                     | Source             | Why selected                              | Applied instruction                                                                 |
| ------------------------- | ------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `test-driven-development` | User-provided path | Required for claim behavior bug fixes.    | Added focused failing regressions before changing production claim CAS behavior.     |

Skipped relevant-looking skills: `javascript-testing-patterns` (the user-provided
TDD workflow governed the test-first change), `typescript-advanced-types` (no
advanced type design was needed), and `nodejs-backend-patterns` (no Node
lifecycle boundary changed).

## Findings Addressed

- Restored expired per-message claim reclaim during inbox claim compare-and-set
  while preserving live claim blocking.
- Updated tests that encoded the opposite no-reclaim behavior, including a
  claim expiring while the claim-row read is pending.
- Removed internal raw callback delivery type assertions from the root
  package export-surface test and kept them in delivery-internal tests.
- Rewrote `build-protocol/DEVELOPER_API.md` so the root-public delivery
  surface is durable inbox/storage primitives and framework-owned replay is
  package-internal/validated.
- Corrected stale docs that said expired and live per-message ownership both
  block competing delivery.

## Red/Green Evidence

- RED: `pnpm --config.verify-deps-before-run=false exec vitest run
  packages/server/test/delivery/delivery-worker.test.ts -t "reclaims"` failed
  with the expected callback-not-invoked assertions for `signal-expired-claim`
  and `signal-expiry-during-read`.
- GREEN: the same focused command passed after `InboxStorage` treated only live
  claims as unavailable and allowed expired claim replacement using the storage
  clock.
- Focused delivery/index regression batch passed after the export-surface test
  cleanup: `pnpm --config.verify-deps-before-run=false exec vitest run
  packages/server/test/delivery/delivery-worker.test.ts
  packages/server/test/delivery/delivery-loop.test.ts
  packages/server/test/delivery/inbox.test.ts packages/server/test/index.test.ts`;
  4 files, 189 tests.

## Files Changed

- `packages/server/src/delivery/inbox-storage.ts`
- `packages/server/src/delivery/inbox-claim.ts`
- `packages/server/test/delivery/delivery-worker.test.ts`
- `packages/server/test/index.test.ts`
- `packages/server/README.md`
- `docs/api/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/tasks/T-0026-transport-backed-delivery-workers/TASK.md`
- `build-protocol/work-logs/T-0026.md`
- `build-protocol/reviews/T-0026-transport-backed-delivery-workers.md`
- `build-protocol/tasks/T-0026-transport-backed-delivery-workers/round-43-fix-report.md`

## Verification

- Passed focused reclaim red/green command as described above.
- Passed focused delivery/index Vitest: 4 files, 189 tests.
- Passed `pnpm --config.verify-deps-before-run=false typecheck:build:generated`.
- Passed `pnpm --config.verify-deps-before-run=false docs:check`; TypeDoc kept
  the existing invalid-`origin` source-link warning and reported 203 expected
  server exports.
- Passed `pnpm --config.verify-deps-before-run=false lint`.
- Ran `pnpm --config.verify-deps-before-run=false format` after the first
  `format:check` reported wrapping needed in the T-0026 durable logs.
- Passed final `pnpm --config.verify-deps-before-run=false format:check`.
- Passed `git diff --check`.
- Passed `git diff --check ca8fb2b3..HEAD`.
- Coordinator verification after the worker returned also passed focused
  delivery/index Vitest with 4 files and 189 tests, generated build typecheck,
  docs check with only the existing invalid-`origin` warning, lint, format
  check, working-tree diff check, and baseline range diff check.

## Commit

No worker commit was created. Coordinator commit is pending.
