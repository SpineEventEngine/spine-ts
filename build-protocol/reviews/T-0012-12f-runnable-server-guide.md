# Review Log: T-0012.12f Runnable Server And Guide

Task log: `build-protocol/tasks/T-0012-12f-runnable-server-guide/TASK.md`
Branch: `task/T-0012-12f-runnable-server-guide`
Baseline commit: `230452d`
Reviewed commit/diff basis: `21c3c27..995e842`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12f-runnable-server-guide`
Status: round 1 review-fix verified; ready for re-review

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Rounds

### Round 1

Reviewed package:
`.superpowers/sdd/review-21c3c27..995e842-12f-runnable-server.diff`

Reviewers:

- code style/maintainability:
  `019f33dc-d3c9-7bf1-b281-43f53c4c1c85` (comments, closed)
- documentation:
  `019f33dc-d450-7380-a9ee-6781ee9ff9b0` (comments, closed)
- TypeScript/API docs:
  `019f33dc-d4bb-78f3-a1f8-5fa3235e186e` (comments, closed)
- security:
  `019f33dc-d574-7192-8b87-d810597c5b49` (clean, closed)
- performance/reliability:
  `019f33dc-d5db-7e42-a268-b565b804c9fc` (comments, closed)

Findings:

- Move the standalone smoke-test `try/finally` immediately after
  `startTodoServer()` so server shutdown is guaranteed.
- Avoid leaving a timeout-wrapped subscription `next()` promise unobserved if
  earlier command/query assertions fail.
- Update the example package description from in-process to runnable
  server-side.
- Bracket IPv6 listener hosts when building `TodoServer.baseUrl`.
- Correct non-chronological task/work-log timestamps and stale pending
  author/reviewer metadata.
- Guard undefined query row states in the guide snippet before `unpackAny()`.

Planned fixes:

- Apply the focused code/docs/log fixes above, rerun focused and full
  verification, commit the fix, and send it back to all five review lanes.

Outcome:

- Review-fix edits address all round 1 findings.
- Verification passed: Prettier, `git diff --check`, `pnpm typecheck`,
  escalated focused Vitest, `pnpm lint`, `pnpm docs:check`, and
  `pnpm proto:check-generated`.
- Re-review package starts after implementation commit `995e842`.
