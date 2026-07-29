# T-0077: Recover and reconcile the dirty root worktree

## Status

Complete; committed, pushed, and represented on canonical `main`.

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

1. Create and push an exact rescue snapshot of every non-human-review dirty
   state before any cleanup.
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
- Rescue commit `def03a41` records the exact non-human-review dirty state.
  Added, modified, and renamed contents are in that commit; its parent
  `f826acec` retains the contents of files recorded as deleted. The pushed
  branch history therefore preserves both the baseline content and deletion
  intent.
- The primary checkout now matches `origin/main` at `39e64841`; only the two
  protected human-review files remain untouched and untracked.

## Rescue Inventory

Git evidence uses the snapshot range `f826acec..def03a41` and the canonical
`origin/main` endpoint `39e64841`.

| Rescued path or path group                                                                                                                                                   | Classification              | Evidence and disposition                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.superpowers/sdd/T-0012-8-round-61-fix-report.md`                                                                                                                           | Already integrated deletion | Content remains at parent `f826acec`; deletion is recorded by `def03a41` and canonical T-0076 commit `39e64841`.                                                                |
| `.superpowers/sdd/T-0012-8-round-62-fix-report.md`                                                                                                                           | Already integrated deletion | Same evidence and disposition as round 61.                                                                                                                                      |
| `.superpowers/sdd/T-0012-8-round-63-fix-report.md`                                                                                                                           | Already integrated deletion | Same evidence and disposition as round 61.                                                                                                                                      |
| `.superpowers/sdd/T-0012-8-round-64-fix-report.md`                                                                                                                           | Already integrated deletion | Same evidence and disposition as round 61.                                                                                                                                      |
| `SPINE_WEB_CLIENT_ANALYSIS_PROMPT.md`                                                                                                                                        | Unique historical research  | Exists in `def03a41` and not `origin/main`; retained only on the rescue branch because accepted Wave 4 decisions and implementation supersede the raw prompt.                   |
| `build-protocol/tasks/T-0038b-context-transport-composition/TASK.md` → `build-protocol/tasks/T-0038-accepted-capability-audit/T-0038b-context-transport-composition/TASK.md` | Obsolete move               | The source blob is preserved by the rename in `def03a41`; `origin/main` retains the canonical source path, so the move is not integrated.                                       |
| `docs/USER_GUIDE.md`                                                                                                                                                         | Superseded                  | Current `origin/main` contains later T-0072, T-0073, and T-0075 guidance.                                                                                                       |
| `docs/check-typescript-snippets.mjs`                                                                                                                                         | Superseded                  | Current `origin/main` contains the evolved snippet checks from the same task line.                                                                                              |
| `eslint.config.mjs`                                                                                                                                                          | Superseded                  | Current `origin/main` contains the evolved package/configuration rules.                                                                                                         |
| `examples/chat/README.md`                                                                                                                                                    | Superseded                  | T-0073/T-0075 commits `5240b44f` and `470cd41f` provide the canonical Chat/model/browser guide.                                                                                 |
| `findings.md`                                                                                                                                                                | Unique historical scratch   | Exists in `def03a41` and not `origin/main`; retained only on the rescue branch.                                                                                                 |
| `packages/client/README.md`                                                                                                                                                  | Superseded                  | The monolithic package was replaced by the Wave 4 client package split; canonical guidance is under `packages/client-node`, `packages/client-web`, and `packages/client-react`. |
| `packages/client/codegen/generate-projection-columns.mjs` → `packages/client/codegen/generate-entity-columns.mjs`                                                            | Superseded rename           | T-0072 commit `608fb80a` integrated the entity-query behavior; Wave 4 moved the canonical generator under `packages/client-node`.                                               |
| `packages/client/package.json`                                                                                                                                               | Superseded                  | Wave 4 package split replaces the monolithic package manifest.                                                                                                                  |
| `packages/client/src/client/client.ts`                                                                                                                                       | Superseded                  | T-0072 behavior and Wave 4 Node/Web/React client implementations are canonical.                                                                                                 |
| `packages/client/src/codegen/index.ts`                                                                                                                                       | Superseded                  | Canonical descendant is under `packages/client-node`.                                                                                                                           |
| `packages/client/src/index.ts`                                                                                                                                               | Superseded                  | Canonical exports are split among the Wave 4 client packages.                                                                                                                   |
| `packages/client/src/projection/projection-column.ts` → `packages/client/src/projection/entity-column.ts`                                                                    | Superseded rename           | T-0072 integrated generic entity querying; Wave 4 moved the maintained API out of the monolithic package.                                                                       |
| `packages/client/src/query/projection-query.ts` → `packages/client/src/query/entity-query.ts`                                                                                | Superseded rename           | Same T-0072/Wave 4 evidence and disposition.                                                                                                                                    |
| `packages/client/test/client-loopback.integration.test.ts`                                                                                                                   | Superseded                  | Later T-0072 and T-0075 tests cover the evolved package topology.                                                                                                               |
| `packages/client/test/client-subscription-types.ts`                                                                                                                          | Superseded                  | Later Node/Web client tests are canonical.                                                                                                                                      |
| `packages/client/test/client-subscriptions.test.ts`                                                                                                                          | Superseded                  | Later Node/Web client tests are canonical.                                                                                                                                      |
| `packages/client/test/client.test.ts`                                                                                                                                        | Superseded                  | Later Node/Web client tests are canonical.                                                                                                                                      |
| `packages/client/test/package-exports.test.ts`                                                                                                                               | Superseded                  | Wave 4 package-specific export tests are canonical.                                                                                                                             |
| `packages/client/test/projection/projection-column.test.ts` → `packages/client/test/projection/entity-column.test.ts`                                                        | Superseded rename           | T-0072 and Wave 4 descendants provide the maintained coverage.                                                                                                                  |
| `packages/client/test/query/projection-query.test.ts` → `packages/client/test/query/entity-query.test.ts`                                                                    | Superseded rename           | T-0072 and Wave 4 descendants provide the maintained coverage.                                                                                                                  |
| `packages/proto-tools/README.md`                                                                                                                                             | Superseded                  | T-0073 commit `5240b44f` provides the complete canonical package guide.                                                                                                         |
| `progress.md`                                                                                                                                                                | Unique historical scratch   | Exists in `def03a41` and not `origin/main`; retained only on the rescue branch.                                                                                                 |
| `task_plan.md`                                                                                                                                                               | Unique historical scratch   | Exists in `def03a41` and not `origin/main`; retained only on the rescue branch.                                                                                                 |
| `human-review-1-jul.md`                                                                                                                                                      | User-owned, not rescued     | Remains untouched and untracked; it was never read, staged, committed, moved, or used as project input.                                                                         |
| `human-review-22-jul.md`                                                                                                                                                     | User-owned, not rescued     | Remains untouched and untracked.                                                                                                                                                |

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

Recovery-state verification passed:

- local `main` and `origin/main` had zero divergence before integration;
- local and remote rescue refs both resolved to `def03a41`;
- root status contained only the two protected untracked human-review files;
- every old and new path in `f826acec..def03a41` occurs in the rescue
  inventory;
- parent content and cited T-0072/T-0073/T-0075 commits resolve through Git;
- the root-installed Prettier check and `git diff --check` passed.

Archived worktrees whose visible dirtiness is only the requested
`.superpowers` deletion are not force-removed because ignored local artifacts
cannot be proven disposable. Their branches and checkout contents remain
preserved. Worktrees with unrelated dirtiness remain untouched.

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

All acceptance criteria are satisfied. No rescued product implementation needs
integration because maintained descendants are already canonical on `main`;
unique research and planning scratch remains recoverable from the pushed rescue
branch.
