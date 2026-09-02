# T-0222: Official Repository Workflow

Status: Ready for human review
Baseline: `origin/master@f85d817d2f5571389ef5152c687dd3baeb2063c8`
Branch: `official-repository-workflow`
Worktree: `.worktrees/official-repository-workflow`

## Objective

Retire the personal fork and make `SpineEventEngine/spine-ts` the sole remote
and development destination. Protect official `master` by routing all future
work through task feature branches and human-managed pull requests.

## Acceptance criteria

1. The local repository has one remote, `origin`, resolving to
   `SpineEventEngine/spine-ts`; `origin/HEAD` resolves to `origin/master`.
2. Canonical agent and build-protocol instructions require fresh
   `origin/master`, isolated non-`codex/` feature branches, and immediate
   feature-branch pushes.
3. Agents never modify official `master`, create or merge pull requests, or
   delete organization refs without explicit human instruction.
4. Historical personal-fork and `origin/main` records remain historical rather
   than being rewritten as current facts.
5. Contributor and release guidance explains the protected-branch workflow and
   merge-triggered version obligation.
6. Git baseline detection uses only official `origin/master`, including when a
   stale `origin/main` ref exists.
7. Published package README source links resolve against official `master`.
8. All 26 workspaces use the next common version, snapshot.6, with internal
   pins, lockfile, Proto metadata, and current-version tests aligned separately
   from the version-only commit.
9. Post-publication verification tolerates bounded NPM propagation delay but
   continues to fail immediately on ambiguous registry responses.

## Human-Imposed Requirements Ledger

- Do not use `armiol/spine-ts` again.
- Treat `SpineEventEngine/spine-ts` as the primary and sole destination.
- Never modify official `master` directly unless the human explicitly asks.
- Create a feature branch for each task.
- Never create branches beginning with `codex/`.
- Do not create or merge pull requests unless the human explicitly asks.
- Preserve the required version-only commit-message pattern.
- Complete this migration quickly without broadening product behavior.

## Skills and execution

- `implement`: make the requested policy change, verify it, review it, and
  commit it on the feature branch.
- `using-git-worktrees`: preserve the dirty primary checkout and implement from
  a clean official-master worktree.
- `review`: run independent standards and specification reviews against the
  fixed official-master baseline.
- `verification-before-completion`: make no completion claim without fresh
  focused and task-level evidence.

No public TypeScript, runtime, wire, persistence, authentication, or package
payload behavior changes. The repository-routing helper and release metadata
are the only executable/versioned seams.
