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

Both dispatches explicitly set the expected model and reasoning. The surface
did not expose actual runtime-model metadata; the immutable configured
`gpt-5.6-terra`/medium profile is the available evidence, so both results are
accepted under the protocol.

Implementation assignment:

- Existing implementer role, bounded to the primary-worktree hygiene rule and
  recovery records: expected `gpt-5.6-terra`, medium reasoning; explicit
  dispatch fields required.

## Investigation Result

- Local `main` stopped at `f826acec` after T-0071 on 2026-07-24.
- Later tasks used isolated worktrees and advanced `origin/main` by 45 commits,
  but the primary checkout was never synchronized.
- Early Wave 3/4 exploration accumulated in that stale primary checkout.
- The rescued client/query, Chat, Proto tooling, and guide changes were later
  integrated in evolved form by T-0072, T-0073, and T-0075.
- The raw research prompt and scratch planning records are unique historical
  artifacts, not unfinished product work.
- Rescue commit `def03a41` preserves every non-human-review path on
  `origin/rescue/dirty-root-20260729`.
- The primary checkout now matches `origin/main` at `39e64841`; only the two
  protected human-review files remain untouched and untracked.

## Review Dispositions

- Style/maintainability: pending classification of any integrated source.
- Documentation: pending classification of any integrated prose.
- TypeScript/API: N/A because no source, export, declaration, generated model,
  or public API changes.
- Performance/reliability: N/A because no runtime, persistence, concurrency,
  lifecycle, resource, retry, or performance behavior changes.
- Security: not a separate task lane unless recovery exposes a security
  boundary; final release policy remains unchanged.

## Verification

Recovery-state verification passed. `git diff --check` and the root-installed
Prettier check passed for the protocol change.

## Recovery Guard

The canonical branch/worktree rules now make the primary checkout
coordination-only, require startup and post-integration primary-checkout and
`main`/`origin/main` inspection, require safe synchronization after a `main`
push, and require an immediate pushed rescue snapshot plus recovery task when
unexpected dirtiness blocks synchronization. Protected human-owned files must
never be staged.

Implementation assignment acceptance: existing implementer role; bounded to
this process rule and recovery records; expected `gpt-5.6-terra` with `medium`
reasoning; both fields were explicit in dispatch. The execution surface does
not expose actual runtime-model metadata, so the immutable configured profile
is the available evidence under the protocol.
