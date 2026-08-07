# T-0124: GCE Registration And Discovery Runtime

Status: Ready for integration

## Objective

Adds `@spine-event-engine/deployment-gce`, which registers a ready GCE
application node in the storage-backed leased registry and lets one standalone
Gateway discover every live node across scaling, crash expiry, scale to zero,
and recovery.

The authoritative acceptance contract is T-0124 in
`build-protocol/planning/WAVE_7_SCALING_REDEPLOYMENT_PLAN.md`.

## Classification

High-risk. This task owns stable cloud identity, metadata input, lease timing,
lost-response recovery, serialized persistence operations, shutdown ordering,
and cross-package server lifecycle integration.

## Baseline And Isolation

- Baseline: `origin/main@92caa9fc`, with T-0123 integrated and post-merge
  verified in a fresh worktree.
- Branch: `task/T-0124-gce-registration-discovery`.
- Worktree: `.worktrees/T-0124-gce-registration-discovery`.
- The dirty primary checkout remains protected and untouched.

## Acceptance Boundary

1. Preserve every observable criterion, RED-first case, documentation duty,
   risk, and exclusion in the authoritative T-0124 plan slice.
2. Create the platform-specific package only under
   `packages/deployment-gce/**`; make only the minimum listener-lifecycle
   integration change under `packages/server/**`.
3. Use injectable metadata, clock, scheduler, registry, identity, and operation
   deadline seams so all timing and failure tests are deterministic and contain
   no wall-clock sleeps.
4. Default to private addressing, HTTP, 20-second renewal, 60-second expiry,
   and 10-second Gateway refresh. Explicit canonical endpoint/TLS overrides
   win; public address selection is never implicit.
5. Serialize initial registration/confirmation, renewal, and cleanup under one
   process identity. Unknown initial outcomes are read-confirmed before retry.
6. Shutdown fences new work, aborts and joins every admitted registry mutation,
   conditionally removes only the owning identity, then permits listener close.
   An operation timeout must not detach a mutation that can complete later.
7. The Gateway consumes all live registry rows, including at least 40, and
   recovers after zero live nodes without adding a node cap or Wave 8 logging.
8. Do not add Terraform, autoscaling policy, Cloud Logging, a second Gateway,
   GKE behavior, Cloud Run, npm publication, migration compatibility, or JVM
   build work.

## Required Gates

- One existing implementer owns all overlapping production files.
- Focused deterministic tests precede specialist review.
- Style/maintainability, documentation, TypeScript/API docs, and
  performance/reliability receive recorded dispositions. Dedicated security is
  N/A because the task adds no external authentication surface; metadata and
  endpoints remain trusted operator/platform inputs.
- Run `pnpm verify:release` after convergence, then merge through a clean
  integration worktree, post-merge verify, push `main`, and remove completed
  branches/worktrees.
- Push every feature-branch commit to `origin` immediately.

## Current Evidence

- Runtime acceptance checkpoints `b16b0920` and `81040ea3` are pushed to the
  task branch. They cover deadline-bound ownership lookup, unref'ed timer
  handles, composed forty-node GCE discovery/Gateway routing/subscription,
  metadata status/body/cancellation behavior, exact 20/60 timing, and numeric
  operation-timeout validation.
- Documentation/API checkpoint verification on 2026-08-07 passed: Prettier,
  TSDoc enforcement, documentation-audience checking, TypeDoc API checking,
  deployment-GCE and server no-emit typechecks, and the focused GCE plus
  listener-lifecycle suites (81 tests).
- Implementation and task-branch gates are complete; merge, post-merge
  verification, and the remote `main` push remain.

## Integration Readiness

- All four specialist review concerns are clean after the recorded correction
  and focused re-review waves. Dedicated per-task security remains N/A for the
  recorded trust-boundary reason.
- The final `pnpm verify:release` passes 197 test files with 3 skipped and 3,925
  tests with 26 skipped. Coverage is 94.05% statements, 90.12% branches, 94.58%
  functions, and 95.08% lines.
- The task branch is ready for clean integration, post-merge verification, and
  remote synchronization of `main`.
