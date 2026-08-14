# T-0186: Converge, Release, And Close Wave 11

Status: Implementation convergence corrected; specialist-review-ready
Start: `2026-08-14 WEST`
End: Pending
Baseline: `f128af42`
Branch: `task/T-0186-wave11-convergence`
Worktree: `.worktrees/T-0186-wave11-convergence`
Classification: High-risk release closure

Implementation owner: existing `implementer`, explicit `gpt-5.6-terra` /
medium. Desktop runtime telemetry does not expose independent child model
metadata; the immutable configured role/profile is the available evidence.

## Objective

Converge the complete Wave 11 generated-interface and interface-routing train,
prove all release and publication invariants together, obtain the final
specialist and security dispositions, integrate, tag, post-merge verify, and
close the Wave.

## Required Inputs

- `AGENTS.md` and `build-protocol/BUILD_PROTOCOL.md`;
- `build-protocol/DECISION_LOG.md` D-0113;
- `build-protocol/planning/WAVE_11_TS_TYPE_ROUTING_PLAN.md`;
- integrated tags `T-0180` through `T-0185`, including `T-0184A`.

## Human-Imposed Requirements Ledger

1. Preserve the fresh frozen upstream `ts_type` contract and its provenance.
2. Preserve generated TypeScript notices and Proto provenance without any
   copyright header.
3. Preserve generated and authored interface validation, same-module recursive
   inheritance, staged compiler inputs, atomic publication, and rollback.
4. Preserve exact-schema then first registered matching interface token then
   replacement/default routing precedence for Command, Event, and state-update
   routing.
5. Preserve route-once admission and durable stored-target replay; catch-up is
   a separate intentional rebuild.
6. Preserve the To-Do create/assign/reassign/unassign proof and its rejection,
   zero/one/two-target, snapshot reset, and no-migration boundaries.
7. `TaskReassignmentEvent`, `routeSemantic`, `@Route`, generated copyright
   headers, absolute generated provenance, hidden multiple-Gateway behavior,
   and Cloud Run support remain absent.
8. Run the existing final security reviewer. No provisional Gateway API or
   Wave 12 implementation belongs in this milestone.

## Acceptance

- A deterministic repository audit classifies all prohibited-name and generated
  provenance results without adding a permanent broad scan to ordinary test
  runs.
- Every generated TypeScript family has one generated/do-not-edit notice,
  stable Proto provenance, and no copyright header or absolute temporary path.
- Publication failure coverage includes semantic validation after Buf,
  generated-tree rename, manifest publication, backup restoration failure,
  coherent generation-ID/commit-point reads, and stage/backup/claim cleanup.
- One complete relevant specialist review wave is collected; confirmed findings
  return as one correction batch and only affected lanes are re-reviewed.
- Every canonical review concern has a concrete CLEAN, accepted, or N/A
  disposition. The existing final security reviewer runs after convergence.
- Cheap preflight passes before one converged `pnpm verify:release`; repository
  branch coverage is at least 90%.
- The reviewed release commit is tagged `T-0186`, fast-forwarded to `origin/main`,
  post-merge verified, and Wave 11 status mirrors are closed.

## Pending Gates

- specialist and security review wave;
- correction/re-review if required;
- cheap preflight and one converged `verify:release`;
- integration, tag, post-merge verification, and cleanup.

## Convergence Evidence (2026-08-14)

- The one-time audit command was an inline `node --input-type=module` inventory
  over the declared generated roots plus the generated registry and server
  fixture families, followed by `rg` excluding build records and test fixtures
  for prohibited active identifiers and deployment-support claims. It is
  recorded here only and was not added as a normal repository gate.
  - Initial output: `generatedFamilyFiles: 169`; exactly two violations:
    `examples/todo/dist/generated/interfaces/task-event.d.ts` and
    `task-assignment-event.d.ts`, both with `notices: 0` and no provenance.
  - Corrected output after the focused TDD fix:
    `{ "generatedFamilyFiles": 169, "violations": [] }`.
  - Active-source scan output for `TaskReassignmentEvent`, `routeSemantic`, and
    `@Route`: no matches. All Cloud Run/multiple-Gateway matches state the
    established unsupported/out-of-scope boundary; the durable binding source
    expressly says it does not coordinate multiple Gateway processes.
- RED: `pnpm exec vitest run scripts/normalize-generated-declarations.test.mjs
-t 'normalizes generated interface declarations with their Proto provenance'`
  failed as expected because the emitted interface declaration had no notice.
- GREEN: the same focused test passed after interface `.d.ts` paths joined the
  declaration normalizer inventory. `pnpm typecheck:build:generated` completed
  and the corrected generated-output audit was clean.
- Publication transaction fixtures passed: `5` focused proto-tools tests and
  `8` focused workflow tests. They cover post-Buf validation, generated-tree
  rename, manifest publication failures, recovery journal/backup behavior,
  generation claim cleanup, and rollback/fail-closed publication boundaries.
- Cheap preflight passed at correction commit `a4ce5fa88b886e12003c9a6a9d0710c094d0a002`:
  `pnpm verify:task -- --coverage scripts/normalize-generated-declarations.test.mjs
--source scripts/normalize-generated-declarations.mjs`. It includes the
  changed-source coverage inspection; `verify:release` was not run.
- Pre-review records head: `6a41476834bd459adf428bd1a09bdd415e16f4d5`, pushed
  to `origin/task/T-0186-wave11-convergence` with a clean worktree.
- The canonical formatter was then applied only to the three inherited
  formatting offenders: `examples/todo/REFERENCE.md`,
  `examples/todo/USER_GUIDE.md`, and
  `scripts/check-typescript-snippets.test.mjs`. The inspected diff is
  formatting-only. The wrapped runnable fence was rechecked by the focused
  reader contract and strict snippet checks (`18` tests passed), followed by
  repository-wide `pnpm format:check`, `git diff --check`, and
  `pnpm verify:task -- --no-coverage scripts/check-typescript-snippets.test.mjs`.
  All passed; no release profile or review was started.
