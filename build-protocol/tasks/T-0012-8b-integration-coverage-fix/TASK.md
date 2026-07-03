# T-0012.8b: Integration Coverage Fix

Status: selected after T-0012.8 integration coverage failure
Start: `2026-07-03 23:15 WEST`
Parent task: `T-0012 Corrective Cleanup And Roadmap Reset`
Branch: `task/T-0012-8b-integration-coverage-fix`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-8b-integration-coverage-fix`
Baseline commit: `939514e`

## Goal

Restore parent integration coverage above the global 90% branch threshold after
merging `T-0012.8 Delivery And Inbox`.

## Trigger

After `T-0012.8` merged into `main` as `939514e`, parent verification passed
through `pnpm test` when escalated for ZeroMQ local IPC, but
`pnpm test:coverage` failed after the same local IPC escalation:

- tests passed: 42 files, 478 tests;
- coverage statements: 94.44%;
- coverage branches: 89.2%, below the 90% threshold;
- coverage functions: 96.95%;
- coverage lines: 94.47%.

The initial non-escalated `pnpm test` and `pnpm test:coverage` failures were
the known sandbox-only ZeroMQ local IPC `Operation not permitted` issue.

## Scope

- Add focused tests or narrowly adjust test fixtures so integration coverage
  returns above the global 90% branch threshold.
- Prefer coverage of meaningful delivery/storage branches introduced by
  `T-0012.8`.
- Do not alter runtime behavior unless a test reveals a real bug.
- Keep the fix small and avoid over-engineering.
- Preserve all existing delivery, storage, transport, generated-code, and
  validation contracts.

## Skill Applicability

Applicable skills selected:

- `test-driven-development`
  (`/Users/armiol/.agents/skills/test-driven-development/SKILL.md`): selected
  because the task should add regression/coverage tests before any production
  change.
- `systematic-debugging`
  (`/Users/armiol/.agents/skills/systematic-debugging/SKILL.md`): selected to
  diagnose the coverage threshold failure from evidence instead of guessing.
- `javascript-testing-patterns`
  (`/Users/armiol/.agents/skills/javascript-testing-patterns/SKILL.md`):
  selected for focused Vitest coverage additions.
- `verification-before-completion`
  (`/Users/armiol/.agents/skills/verification-before-completion/SKILL.md`):
  selected for completion gating.
- `requesting-code-review` and `receiving-code-review`
  (`/Users/armiol/.agents/skills/requesting-code-review/SKILL.md`,
  `/Users/armiol/.agents/skills/receiving-code-review/SKILL.md`): selected for
  review loop handoff and response.

Skill evidence:

- Session inventory exposed the selected skills.
- Repo expected-skill manifest inspected:
  `build-protocol/skills/EXPECTED_SKILLS.md`.
- Installed entrypoints enumerated with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
- Installed lock inspected at `/Users/armiol/.agents/.skill-lock.json`.

Skipped relevant-looking skills:

- `performance`: reviewer lane only unless the fix changes runtime behavior.
- `security-best-practices`: reviewer lane only; this task is expected to be
  test-only.
- `event-store-design`, `cqrs-implementation`, and `projection-patterns`:
  deferred because the immediate issue is coverage, not design.

## Required Verification

- Focused tests that cover the added/changed cases.
- Escalated `pnpm test` if local IPC tests hit sandbox permissions.
- Escalated `pnpm test:coverage` if local IPC tests hit sandbox permissions.
- `pnpm typecheck`.
- `pnpm lint`.
- Tracked-file Prettier check, excluding unrelated untracked
  `human-review-1-jul.md`.
- `node scripts/check-api-docs.mjs` if docs/API text changes.
- `git diff --check`.

## Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Current State

- Task branch and worktree are created from parent integration commit
  `939514e`.
- Implementation has not started.
- No blocking human question is known.
