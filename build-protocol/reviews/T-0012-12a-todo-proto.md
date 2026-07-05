# Review Log: T-0012.12a Todo Proto Generation

Task log: `build-protocol/tasks/T-0012-12a-todo-proto/TASK.md`
Branch: `task/T-0012-12a-todo-proto`
Baseline commit: `07d06a2`
Reviewed commit/diff basis: implementation commit `cbdb35c`; current HEAD
pending re-review
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12a-todo-proto`
Status: second focused reliability fix complete; orchestrator inspection pending

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Implementation Review Rounds

- Review findings received for stale logs, stale dependency/docs wording,
  non-staged generated-root cleanup, root test/coverage generation, and example
  generated import build readiness.
- Fix pass started from implementation commit `cbdb35c`; orchestrator resumed
  after interruption and verified before commit.
- Fix pass sub-agent reported passing generation, focused smoke,
  generated-clean, typecheck, lint, format, docs, diff whitespace,
  generated-output ignore/tracked checks, and escalated coverage.
- Main orchestrator reran verification after interruption. All non-sandbox
  checks passed; sandboxed coverage reproduced local IPC/HTTP2 restrictions;
  escalated coverage passed with 45 files, 621 tests, branches 90.22%.
- Review-fix pass committed at current HEAD; required re-review lanes are
  pending.
- Re-review round received clean security and TypeScript/API docs results.
  Documentation found stale README/task wording. Maintainability found helper
  order, test naming, work-log readability, and coverage-count wording issues.
  Reliability found two blocking publish problems: live generated roots can be
  temporarily missing during replacement, and a later target failure can leave
  mixed generated roots. A focused fix pass is required before another review.
- First focused fix pass addressed most findings but kept a live-root rename
  swap window. Orchestrator rejected that part before commit; a second narrow
  fix pass must keep generated roots present by mirroring staged output into
  existing roots with backup/restore.
- Focused fix pass began from HEAD `ddefd95` at `2026-07-05 12:26 WEST`.
  Planned fixes: stage all generated targets before publishing, keep publish
  backups until batch success, roll back already-published roots on later
  publish failure, add publish-path regression coverage, and correct stale
  documentation/log wording.
- Focused fix pass completed at `2026-07-05 12:34 WEST`. Required
  non-coverage checks passed. Sandboxed `pnpm test:coverage` failed only on
  local IPC/HTTP2 permissions (`Operation not permitted` and
  `listen EPERM 127.0.0.1`); escalated rerun was requested but rejected by the
  environment policy, so orchestrator rerun remains pending.
- Second focused reliability fix pass completed at `2026-07-05 12:41 WEST`.
  The publisher now backs up generated-root contents into stage-owned backup
  directories and mirrors staged files into the existing roots instead of
  renaming live roots away. Focused workflow coverage now includes live-root
  presence during publish, missing staged output preserving the prior root,
  later target failure rollback, orphan cleanup, and staged symlink rejection.
  Required verification passed: focused proto workflow Vitest,
  `pnpm proto:generate`, `pnpm proto:check-generated`, `pnpm typecheck`,
  `pnpm lint`, `pnpm format:check`, and `git diff --check`.
- Main orchestrator verified the second focused fix at `2026-07-05 12:49 WEST`.
  All required non-sandbox checks passed. Sandboxed coverage reproduced local
  IPC/HTTP2 permission failures; escalated coverage passed with 45 files,
  625 tests, statements 95.06%, branches 90.22%, functions 97.60%, and lines
  95.08%.
