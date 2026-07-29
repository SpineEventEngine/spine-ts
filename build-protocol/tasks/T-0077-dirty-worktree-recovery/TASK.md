# T-0077: Recover and reconcile the dirty root worktree

## Classification

High-risk maintenance. The task handles a large uncommitted snapshot, branch
reconciliation, and eventual destructive cleanup. Incorrect handling could
lose unique source, tests, examples, or documentation.

## Objective

Explain how the root worktree became dirty, preserve every recoverable change
durably, classify each path against integrated and historical branches, restore
a safe current checkout, and integrate any valid unique work through the normal
review and verification gates.

## Human-Imposed Requirements Ledger

- Investigate why substantial work remained dirty and uncommitted.
- Address the condition rather than merely reporting it.
- Do not lose any work.
- Do not read, edit, stage, commit, delete, move, or use
  `human-review-1-jul.md` as project input.
- Preserve `human-review-22-jul.md` as user-owned untracked material.
- Push every commit to `origin` immediately.
- Preserve unrelated worktree contents.
- Do not build Spine JVM.

## Acceptance Criteria

1. Create and push an immutable rescue snapshot of every non-human-review dirty
   path before any cleanup.
2. Classify each tracked and untracked path as already integrated, moved,
   superseded, incomplete unique work, or user-owned material, with Git
   evidence.
3. Identify the root cause and timeline using branch/reflog/worktree evidence.
4. Integrate valid unique work only after focused tests and relevant review.
5. Leave the root checkout on current `main` with no recoverable work present
   only in its working tree. Human-review files remain untouched and untracked.
6. Verify and push the task branch and updated `main`.

## Investigation Assignments

Before dispatch:

- Orchestrator-dispatched read-only Git provenance scan: expected
  `gpt-5.6-terra`, medium reasoning; explicit dispatch fields required.
- Orchestrator-dispatched read-only content/topology scan: expected
  `gpt-5.6-terra`, medium reasoning; explicit dispatch fields required.

Runtime metadata and results are pending.

## Review Dispositions

- Style/maintainability: pending classification of any integrated source.
- Documentation: pending classification of any integrated prose.
- TypeScript/API: pending classification of public-contract changes.
- Performance/reliability: pending classification of runtime changes.
- Security: not a separate task lane unless recovery exposes a security
  boundary; final release policy remains unchanged.

## Verification

Pending.
