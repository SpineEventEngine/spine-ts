# T-0079: Prune obsolete remote branches

## Status

In progress.

## Classification

High-risk repository maintenance. The task deletes remote Git refs, so a wrong
classification could hide unique work or remove an active collaboration point.

## Objective

Reduce the GitHub branch list to active development branches while preserving
every unique historical or rescue tip under an immutable remote tag.

## Human-Imposed Requirements Ledger

- Review the large GitHub branch list.
- Remove branches that are no longer needed.
- Do not lose any work.
- Push every commit immediately.
- Preserve and do not read, edit, stage, commit, delete, move, or use
  `human-review-1-jul.md`.
- Preserve `human-review-22-jul.md` as user-owned untracked material.
- Use isolated worktrees.
- Do not build Spine JVM.

## Acceptance Criteria

1. Capture the exact live remote-head inventory and classify every head.
2. Never delete `main` or an active task branch.
3. Delete merged task and integration branches after proving ancestry.
4. Delete a patch-equivalent branch only after proving it has no unique patch.
5. Create and verify immutable remote archive tags for every unique legacy or
   rescue tip before deleting the corresponding remote branch.
6. Record the exact deleted branches, retained branches, tags, and recovery
   instructions.
7. Finish with local/remote `main` equality and no unclassified remote head.

## Safety Policy

- Merged task and integration branches are redundant after their tips are
  ancestors of `main`.
- The communication branch is redundant only if `git cherry` proves no unique
  patch relative to `main`.
- Non-ancestral legacy and rescue tips are unique preservation state. Create
  and push exact lightweight archive tags before deleting their remote heads.
- Keep the T-0079 task branch until this task is integrated, verified, and
  closed.

## Investigation Assignment

- Orchestrator-dispatched remote-ref classification scan.
- Scope: every live remote head, ancestry, patch equivalence, unique-tip
  preservation, exact proposed tag and deletion sets.
- Expected/configured profile: `gpt-5.6-luna`, medium reasoning, explicitly
  dispatched.
- Runtime metadata will be recorded if exposed; otherwise the immutable
  configured profile is the available evidence.

## Verification

Pending.
