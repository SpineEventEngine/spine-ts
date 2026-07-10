# T-0026 Round 45 Fix Report

Status: committed; re-review pending
Date: `2026-07-10`

Branch: `task/T-0026-transport-backed-delivery-workers`
Worktree: `.worktrees/T-0026-transport-backed-delivery-workers`
Worker commit: none.
Coordinator commit: `9546ed2a` (`Close server environment delivery type leak`).

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

| Skill                     | Source             | Why selected                                | Applied instruction                                               |
| ------------------------- | ------------------ | ------------------------------------------- | ----------------------------------------------------------------- |
| `test-driven-development` | User-provided path | Required for the API/type behavior changes. | Added focused type assertions and watched tooling typecheck fail. |

Skipped relevant-looking skills: `projection-patterns` because this fix only
narrows replay typing and preserves existing projection replay semantics, and
`typescript-advanced-types` because the narrowing used straightforward local
literal intersections rather than advanced type machinery. I also skipped
`security-best-practices` because the fail-closed status validation already
existed at runtime and this round did not change trust boundaries.

Project protocol, task ledger, and the user prompt take precedence over skill
advice.

## Findings Addressed

- Closed the root-public `ServerEnvironment` raw `Delivery` type leak by
  replacing public delivery option/property types with the existing small
  `ServerEnvironmentCloseable` owner type. No raw delivery callbacks,
  `DeliveryOptions`, or direct-drain APIs are exposed through these root-public
  declarations.
- Mirrored the process-manager replay pattern for projection inbox handoff:
  `ProjectionInboxTarget.replay()` now accepts only a pending
  `UPDATE_SUBSCRIBER` message, while `ProjectionInbox.replay()` remains the
  broader internal entrypoint with runtime validation before target invocation.
- Updated replay-validation docs to mention pending `TO_DELIVER` status
  validation before process-manager/projection handler execution.
- Updated remaining historical Round 35 no-reclaim records to name Round 43 /
  `9477830c` as the later expired-claim reclaim supersession.
- Updated Round 44 records to distinguish fix commit `9bb68f33` from
  records-only status commit `52a4326d`, and fixed the wrapped review-log
  commit-title line.

## Red/Green Evidence

- RED: `pnpm --config.verify-deps-before-run=false typecheck:tooling` failed
  after adding type assertions. The projection target message still allowed
  non-`UPDATE_SUBSCRIBER` labels and non-`TO_DELIVER` statuses, and
  `ServerEnvironment*Options["delivery"]` still exposed the internal raw
  `Delivery` type.
- GREEN: the same `typecheck:tooling` command passed after narrowing the
  projection target type and replacing the public environment delivery type
  with `ServerEnvironmentCloseable`.
- Focused runtime/API batch passed after local-listener approval:
  ```text
  pnpm --config.verify-deps-before-run=false exec vitest run \
    packages/server/test/index.test.ts \
    packages/server/test/server/server.test.ts \
    packages/server/test/context/projection-handoff.test.ts \
    packages/server/test/context/process-manager-handoff.test.ts \
    packages/server/test/repository/repository-routing.test.ts
  ```
  Result: 5 files, 179 tests. The sandboxed first attempt failed only on `listen EPERM`
  for `127.0.0.1`.

## Files Changed

- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/reviews/T-0026-transport-backed-delivery-workers.md`
- `build-protocol/tasks/T-0026-transport-backed-delivery-workers/TASK.md`
- `build-protocol/tasks/T-0026-transport-backed-delivery-workers/round-35-fix-report.md`
- `build-protocol/tasks/T-0026-transport-backed-delivery-workers/round-44-fix-report.md`
- `build-protocol/tasks/T-0026-transport-backed-delivery-workers/round-45-fix-report.md`
- `build-protocol/work-logs/T-0026.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `packages/server/README.md`
- `packages/server/src/repository/repository.ts`
- `packages/server/src/server/server-environment.ts`
- `packages/server/test/context/projection-handoff.test.ts`
- `packages/server/test/index.test.ts`
- `packages/server/test/server/server.test.ts`

## Verification

- Passed `pnpm --config.verify-deps-before-run=false typecheck:tooling`.
- Passed focused runtime/API Vitest after local-listener approval: 5 files,
  179 tests.
- Passed `pnpm --config.verify-deps-before-run=false typecheck:build:generated`.
- Passed `pnpm --config.verify-deps-before-run=false docs:check`; TypeDoc kept
  the existing invalid-`origin` source-link warning and reported the expected
  API export counts.
- Passed `pnpm --config.verify-deps-before-run=false lint`.
- Ran `pnpm --config.verify-deps-before-run=false format` after the first
  `format:check` reported wrapping needed in the T-0026 work/review logs.
- Passed final `pnpm --config.verify-deps-before-run=false format:check`.
- Passed `git diff --check`.
- Passed `git diff --check ca8fb2b3..HEAD`.
- Continuation coordinator removed one detached task-log continuation line and
  reran the same focused runtime/API Vitest batch plus tooling typecheck,
  generated build typecheck, docs check, lint, final format check, and both diff
  checks successfully before the coordinator commit.

## Commit

No worker commit was created. Coordinator commit `9546ed2a` (`Close server environment delivery type leak`) recorded this round.
