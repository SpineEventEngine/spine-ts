# T-0214 evidence

## Baseline

- Baseline: `origin/main@8c878f0428d1b9ea959b47bf4b2155f4993a092d`.
- Frozen installs passed in four worktrees.
- Generated build setup passed after fresh Proto generation.
- Focused unchanged baselines: auth subscriptions 56/56; To-Do 83/83; Message
  Board app/model/UI 131/131.

## Pending

- Per-lane RED/GREEN evidence, coverage, preflight, commits, pushes, reviews.
- Integrated live launchers, Compose/browser/PID/shutdown evidence.
- Final release and post-merge verification.

## Framework subscription lifetime

- Pushed implementation commits: `ef71612d`, `c8912a19`, and `e0d2f03d`.
- RED proved an active stream crossed the finite-operation timeout; a second RED
  proved cancellation could occur synchronously before callback return.
- Final `verify:task` passed 58/58 focused tests with 90.19% branch coverage for
  `packages/auth/src/subscriptions/index.ts`.
- Final style and performance/reliability re-reviews passed. TypeScript/API-doc
  and prose-documentation concerns are N/A because no public declaration,
  export, TSDoc, or documentation contract changed.
