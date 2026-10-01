# Fix prepared release validation

## Scope and acceptance

Standard release-tooling correction on `fix-release-manifest-order`, based on
official master `230985421fe33a264c58a5e2d5a935faf791c741`. Reuse the existing
clean worktree. No application runtime or public API changes are intended.

The Publish run 36898750559 failed before npm was called: `loadPrepared()`
rejected the prepared release as not dependency ordered. Reproduce this with
the real workspace dependency graph, establish the cause, and correct it.
Preparation must exercise the same artifact validation used before publishing;
the regression must run in regular PR checks. Preserve checksum, inventory,
source-commit, dependency, and ordering checks. Do not publish or rerun workflows.

All workspace packages must advance from snapshot.19 to one unused common
snapshot version, in the required separate version-only commit. Update active
version examples and internal pins separately, preserving historical records.

## Plan and estimate

1. Reproduce with a failing test, then apply the smallest correction.
2. Verify the prepare/load handoff without calling npm publish.
3. Run three independent, sequential reviews without chat history or memory;
   fix all confirmed findings between rounds.
4. Run cheap checks and the release profile after convergence; push each commit.

Initial estimate: 0.5–0.8 hours; with three requested review rounds, 0.7–1.0
hours. This includes focused reproduction, correction, reviews, version
alignment, and the required full release check. No new publication strategy,
third-party patches, or unrelated runtime work is authorized.

## Assignments and review concerns

- Implementation: existing implementer role, explicit `gpt-6-sol` / `medium`.
  Scope: release scripts, regression tests, directly affected release docs.
- Mechanical checks: orchestrator-dispatched function, `gpt-6-luna` / `low`
  when delegated. No new role.
- Three sequential independent technical reviews: existing performance/
  reliability reviewer in rounds 1 and 3, style/maintainability reviewer in
  round 2, explicit `gpt-6-sol` / `medium`. Fresh context every round.
- The existing documentation reviewer checks the changed runbook and script
  documentation during round 2, explicit `gpt-6-luna` / `medium`.
- TypeScript public API concern: N/A unless implementation changes an API;
  no framework declarations or runtime behavior are planned.
- Final project security review: N/A for this bounded correction; release
  validation checks must nevertheless remain intact.

The Desktop supports explicit model/reasoning profiles. Record actual runtime
metadata when exposed; otherwise retain explicit configured dispatch evidence.
Subagents must not delegate. Only one writer changes release implementation.

## Human-Imposed Requirements Ledger

- Fix the actual publishing failure; start on a fresh branch from updated master.
- Three sequential independent review/fix rounds, no memory or chat history.
- Keep trusted publishing and provenance; do not patch third-party libraries.
- Keep code and explanations simple; preserve dependency and artifact checks.
- Follow common workspace version bumps, immediate pushes, and release checks.
- No actual package publication, workflow reruns, PR creation, or merge.

## Questions

None. The user explicitly requested a fix and three review/fix rounds.
