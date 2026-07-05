# Review Log: T-0012.12f Runnable Server And Guide

Task log: `build-protocol/tasks/T-0012-12f-runnable-server-guide/TASK.md`
Branch: `task/T-0012-12f-runnable-server-guide`
Baseline commit: `230452d`
Last completed review basis: `995e842..9872e7d`
Current pending review basis: `9872e7d..21470bc`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12f-runnable-server-guide`
Status: round 3 metadata follow-up re-review in progress

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

### Round 2

Reviewed package:
`.superpowers/sdd/review-995e842..9872e7d-12f-review-fix.diff`

Reviewers:

- code style/maintainability:
  `019f33e4-692d-7623-8b95-14b5f9486f97` (metadata comments, closed)
- documentation:
  `019f33e4-69ca-74f2-9f60-1d6963b64ce1` (metadata comments, closed)
- TypeScript/API docs:
  `019f33e4-6a3a-7e82-b4db-0d0b20f7363e` (clean, closed)
- security:
  `019f33e4-6af0-7002-8a77-24c5059c6380` (clean, closed)
- performance/reliability:
  `019f33e4-6b5b-77b0-bf20-52752dc2d6c1` (clean, closed)

Findings:

- Update stale task/report/work-log wording that still described the
  `9872e7d` review-fix commit as pending or in progress.
- Record the round 2 review result explicitly before the next re-review.

Planned fixes:

- Apply metadata-only log corrections, verify formatting and diff hygiene,
  commit the follow-up, and send the metadata diff back to all five review
  lanes.

Outcome:

- Metadata follow-up was committed as `21470bc`.
- Verification passed: changed-log Prettier check and `git diff --check`.
- Re-review package: `.superpowers/sdd/review-9872e7d..21470bc.diff`.

### Round 3

Reviewed package:
`.superpowers/sdd/review-9872e7d..21470bc.diff`

Reviewers:

- code style/maintainability:
  `019f33e9-206f-7262-962b-101312217ecc` (metadata comments, closed)
- documentation:
  `019f33e9-3cc9-7863-9c52-80698551fe28` (metadata comments, closed)
- TypeScript/API docs:
  `019f33e9-57a3-7262-8e3a-d879fee3cb3a` (clean, closed)
- security:
  `019f33e9-7376-7861-8055-bc436c986034` (clean, closed)
- performance/reliability:
  `019f33e9-9858-71f3-a668-bc6c03618b78` (metadata comments, closed)

Findings:

- Update the work-log current state so it does not say the already committed
  metadata follow-up still needs to be committed.
- Distinguish the last completed review basis from the current pending review
  basis.
- Record follow-up verification evidence in the implementation report and
  work log.

Planned fixes:

- Apply this metadata-only correction, verify formatting and diff hygiene,
  commit the follow-up, and send the new metadata diff back to all five review
  lanes.
