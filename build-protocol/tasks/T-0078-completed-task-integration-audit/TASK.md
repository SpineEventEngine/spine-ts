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

All three dispatches explicitly set the expected model and reasoning. Runtime
self-metadata was unavailable; the configured profiles are the available
evidence and the results are accepted under the protocol.

## Investigation Results

- 176 task records on `main` contain completion or acceptance terms.
- 722 commit-like identifiers were extracted from task integration, merge,
  commit, branch, and push evidence. Of 708 identifiers that resolve to
  repository commits, all 708 are ancestors of `origin/main` at the audit
  baseline.
- All 60 completed remote task branches and both integration branches are
  ancestors of `origin/main`.
- Modern T-0046 and T-0048 through T-0077 work is committed, represented on
  `main`, and reflected by local remote-tracking refs.
- `codex/communication-milestones` is non-ancestral but has no unique patch
  content versus `main`.
- The pushed `rescue/dirty-root-20260729` branch is preservation-only and does
  not contain a missing current implementation.
- T-0048 had 16 unique untracked planning/review artifacts. They are now
  committed as `cf608c7b` and pushed on
  `rescue/T-0048-planning-20260729`; they do not belong on product `main`.
- Dirty historical worktrees contain no unique uncommitted source blobs.
  T-0066/T-0067 changes are executable-bit-only; T-0012-11b deletions are
  represented by later canonical history; recurring `.superpowers` deletions
  are intentional.

## Legacy Branch Ambiguity

Local T-0012a–g and T-0013.1–.6 branch families contain non-ancestral commits
and lack remote task refs. T-0012 is explicitly abandoned by the current build
protocol; T-0013 predates later canonical aggregate, registry, decorator, and
reactor implementations. Raw merging would reintroduce obsolete architecture.

Before disposition, dispatch the existing requirements splitter for a
capability-level mapping and exact preservation/push plan:

- Expected profile: `gpt-5.6-sol`, high reasoning.
- Model and reasoning must be explicit in dispatch.
- Scope: determine which branch families are completed, abandoned,
  superseded, or incomplete; map accepted capabilities to canonical `main`;
  identify any genuine missing behavior; and specify which legacy refs must be
  pushed without merging.

## Review Dispositions

- Style/maintainability: pending status-reconciliation implementation.
- Documentation: pending audit matrix and status reconciliation.
- TypeScript/API: N/A unless a genuine missing implementation is found.
- Performance/reliability: N/A unless a genuine missing implementation is
  found.
- Security: N/A unless the audit exposes missing security-boundary work.

## Verification

Pending.
