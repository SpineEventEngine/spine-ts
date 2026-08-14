# T-0186: Converge, Release, And Close Wave 11

Status: In implementation; audit and review preparation
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

- one-time repository and generated-output audit;
- specialist and security review wave;
- correction/re-review if required;
- cheap preflight and one converged `verify:release`;
- integration, tag, post-merge verification, and cleanup.
