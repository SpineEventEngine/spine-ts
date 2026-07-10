# T-0026 Round 41 Fix Report

Status: fixes verified; coordinator commit and re-review pending

Branch: `task/T-0026-transport-backed-delivery-workers`
Worktree: `.worktrees/T-0026-transport-backed-delivery-workers`
Worker commit: none; final coordinator commit pending.

## Skill Applicability

Canonical checklist source: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

| Checklist item | Evidence | Result |
| --- | --- | --- |
| Session inventory | The Codex session exposed workflow, testing, TypeScript, backend, security, review, and verification skills. | Task-relevant subset triaged. |
| Task-provided skills | User required `/Users/armiol/.agents/skills/test-driven-development/SKILL.md`. | Fully read before test or production edits. |
| Expected-skill manifest | Read `build-protocol/skills/EXPECTED_SKILLS.md`. | Expected workflow/backend skills are locally installed. |
| Installed entrypoints | `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print` succeeded over the full user skill directory. | Metadata triaged without reading unrelated skill bodies. |
| Installed-skill manifest | Read `/Users/armiol/.agents/.skill-lock.json`. | Readable; confirms expected source repositories and local paths. |

Selected skills:

| Skill | Source | Why selected | Applied instruction |
| --- | --- | --- | --- |
| `test-driven-development` | User-provided path | Required reliability behavior change and regression. | Add a focused regression, watch it fail before production changes, then make it pass. |
| `verification-before-completion` | Session inventory / `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md` | User prescribed final verification commands. | Read before completion; report only fresh command evidence. |

Skipped relevant-looking skills:

| Skill | Metadata/path evidence | Reason |
| --- | --- | --- |
| `javascript-testing-patterns` | Session inventory and `/Users/armiol/.agents/skills/javascript-testing-patterns/SKILL.md`. | The supplied TDD instructions govern the required test-first workflow; existing local Vitest patterns will be followed. |
| `nodejs-backend-patterns` | Expected manifest and `/Users/armiol/.agents/skills/nodejs-backend-patterns/SKILL.md`. | The smallest fix removes an unnecessary public API and adjusts an existing bounded scan, without adding Node service/lifecycle behavior. |
| `security-best-practices` | Session inventory lists the JS/TS security skill. | The finding is resolved by reducing a public export; repository and task boundary rules are more specific. |
| `typescript-advanced-types` | Expected manifest and `/Users/armiol/.agents/skills/typescript-advanced-types/SKILL.md`. | No advanced type design is expected; the existing API-export test will guard the surface. |

## Scope And Initial Evidence

- Round 41 addresses range whitespace in the Round 40 report, the root-exported
  raw `DeliveryWorker` callback boundary, and partial stale-head scan paging.
- Initial `git diff --check ca8fb2b3..HEAD` fails because Round 40 has Markdown
  hard-break whitespace on its branch/worktree lines.
- The task requires the relevant Spine JVM delivery source/docs inspection
  before server runtime/API edits. Read
  `spine-jvm-docs/spine-routing-dispatch-and-delivery.md` on repository inbox
  dispatch, labels, and delivery; a bounded `rg --files` search found no local
  `core-jvm/server` source checkout. The notes confirm framework-owned normal
  inbox delivery, so the raw `DeliveryWorker` root export is removed rather
  than widening replay endpoints.

## Red/Green Evidence

- RED: after importing the existing numbered inbox-query probe, ran
  `pnpm --config.verify-deps-before-run=false exec vitest run
  packages/server/test/delivery/delivery-worker.test.ts -t 'keeps a partial
  stale-head rescan paged'`. It failed only at the intended assertion:
  `faults.inboxQueries` was `1004`, not `5`, while the supported row delivered.
- GREEN: the same focused command passed after production changes: one test
  passed with 50 skipped. The partial stale-head scenario now delivers the
  supported row with `faults.inboxQueries === 5` and `processed === 1001`.

## Changed Files

- `packages/server/src/delivery/delivery.ts`: allow one bounded rescan page of
  already-seen rows without enlarging the finite unique-row scan budget.
- `packages/server/test/delivery/delivery-worker.test.ts`: add the partial
  stale-head query-count regression.
- `packages/server/src/index.ts`, root export tests, API docs checks, and public
  delivery documentation: remove `DeliveryWorker` and its raw callback options
  from the public package surface.
- `round-40-fix-report.md`: remove the two committed Markdown trailing spaces.
- Round 41 task, work, review, and fix records: record the selected skills,
  JVM inspection, red/green evidence, and coordinator-commit status.

## Verification

- Passed focused regression: `1` passed, `50` skipped.
- Passed prescribed focused Vitest command: `5` files, `194` tests.
- Passed `pnpm --config.verify-deps-before-run=false typecheck:build:generated`.
- Passed `pnpm --config.verify-deps-before-run=false docs:check`; TypeDoc kept
  its existing invalid-`origin` source-link warning.
- Passed `pnpm --config.verify-deps-before-run=false lint`.
- Passed `pnpm --config.verify-deps-before-run=false format:check`.
- Passed working-tree `git diff --check`.
- `git diff --check ca8fb2b3..HEAD` still fails on the two Round 40 spaces
  because they are in current committed `HEAD`; the uncommitted Round 41 repair
  cannot change that range. The coordinator must commit this repair, then rerun
  the required range check against the new `HEAD`.

## Commit

No worker commit was created. Final coordinator commit remains pending.
