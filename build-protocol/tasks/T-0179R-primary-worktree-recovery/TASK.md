# T-0179R: Primary Worktree Recovery

Status: Open; rescue snapshot pushed, reconciliation deferred

## Trigger

Before T-0179 integration on 2026-08-13, the primary checkout was found on
stale `main` commit `1c53cbdf` while `origin/main` was at `8ef4c066`. It also
contained six modified tracked files and four untracked files.

## Safety State

- Rescue commit `7735a00f` on
  `rescue/T-0179-primary-20260813` preserves the six tracked modifications and
  the two non-protected untracked files exactly as found.
- `human-review-1-jul.md` and `human-review-22-jul.md` are protected user-owned
  files. They were not read, copied, staged, moved, or committed.
- The primary checkout itself was not switched, reset, staged, or otherwise
  modified during rescue.

## Required Recovery

1. Classify the rescued paths as integrated, superseded, unique incomplete
   work, or user-owned material.
2. Reconcile only confirmed unique work through a reviewed task branch.
3. Synchronize the primary checkout with `origin/main` only when its protected
   working-tree state can be preserved without loss.
4. Remove the rescue worktree and branch only after recovery is complete and
   the human-owned files remain untouched.

This recovery task does not block Wave 11 integration through a separate clean
coordination worktree because the rescue state is durable on `origin` and the
primary checkout remains unchanged.
