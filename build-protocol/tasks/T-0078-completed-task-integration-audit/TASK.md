# T-0078: Audit completed-task integration

## Status

In progress.

## Classification

High-risk repository maintenance. The audit may expose committed or
uncommitted task work outside `main`; incorrect reconciliation could duplicate
superseded code or lose unique work.

## Objective

Prove that every task durably recorded as completed has its accepted code and
records committed, pushed, and represented on canonical `main`. Rescue and
integrate any unique missing work through the normal task gates.

## Human-Imposed Requirements Ledger

- Review the repository after T-0077.
- Every task known to be completed must have its code committed and pushed.
- Completed accepted work must be merged where it belongs.
- Do not lose any work.
- Do not read, edit, stage, commit, delete, move, or use
  `human-review-1-jul.md` as project input.
- Preserve `human-review-22-jul.md` as user-owned untracked material.
- Push every commit to `origin` immediately.
- Use isolated worktrees and preserve unrelated dirty contents.
- Do not build Spine JVM.

## Acceptance Criteria

1. Build a machine-derived inventory of durable completed-task records.
2. For each completed task, prove direct ancestry on `main` or document the
   later canonical commit(s) that contain its accepted work.
3. Compare relevant local task/integration branches with remote refs.
4. Inspect dirty completed-task worktrees without reading protected files;
   rescue unique work before cleanup or integration.
5. Integrate, review, verify, and push any accepted missing implementation.
6. Record explicit dispositions for historical branches whose accepted content
   is represented by later `main` history.
7. Finish with local/remote `main` equality and no known completed accepted
   work existing only in a local branch or worktree.

## Investigation Assignments

Before dispatch:

- Orchestrator-dispatched completion-ledger and ancestry scan: expected
  `gpt-5.6-terra`, high reasoning; explicit dispatch fields required.
- Orchestrator-dispatched local/remote ref synchronization scan: expected
  `gpt-5.6-terra`, medium reasoning; explicit dispatch fields required.
- Orchestrator-dispatched dirty-worktree uniqueness scan: expected
  `gpt-5.6-terra`, high reasoning; explicit dispatch fields required.

Runtime metadata and results are pending.

## Review Dispositions

- Style/maintainability: pending audit outcome.
- Documentation: pending audit outcome.
- TypeScript/API: pending audit outcome.
- Performance/reliability: pending audit outcome.
- Security: N/A unless the audit exposes missing security-boundary work.

## Verification

Pending.
