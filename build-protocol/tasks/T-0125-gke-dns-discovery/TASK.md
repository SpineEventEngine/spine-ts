# T-0125: GKE DNS Discovery Runtime

Status: Ready for integration

## Objective

Adds `@spine-event-engine/deployment-gke`, allowing one standalone Gateway to
discover every ready application Pod behind a configured GKE headless Service
and follow scale up, scale down, zero, and recovery without a leased registry.

The authoritative acceptance contract is T-0125 in
`build-protocol/planning/WAVE_7_SCALING_REDEPLOYMENT_PLAN.md`.

## Classification

High-risk. This task adds a public runtime package and owns DNS TTL/failure
semantics, address identity and TLS authority, cancellation/timer lifecycle,
dynamic Gateway connection/subscription reconciliation, and scale-to-zero
recovery.

## Human-Imposed Requirements Ledger

1. DNS readiness is the only GKE membership authority; do not add a registry,
   registrar, Kubernetes watch, or public-address inference.
2. Discovery publishes complete current snapshots, preserves canonical endpoint
   identity and HTTPS Service-name authority, and supports IPv4 and IPv6.
3. Refresh uses the earlier configured interval or positive TTL, with zero or
   missing TTL falling back to the configured interval for scheduling and
   validity.
4. Empty or name-not-found answers apply immediately and recover after scale to
   zero; failures retain a valid answer only until expiry and then publish one
   empty snapshot while retries continue.
5. Cancellation and shutdown leave no timers, DNS work, connection attempts,
   or streams running.
6. Expected count is 32 but is not a cap: every returned address, including 40,
   is used without public count diagnostics or error logging.
7. Keep the implementation small, use RED/GREEN behavior tests and deterministic
   scheduling, preserve unrelated user work, and push every checkpoint to
   `origin`.
8. Do not add Terraform, autoscaling policy, Cloud Logging, multiple Gateways,
   Cloud Run, npm publication, or JVM build work.

## Baseline And Isolation

- Baseline: `origin/main@6b2e29ea`, with T-0124 integrated, post-merge
  verified, and remotely synchronized.
- Branch: `task/T-0125-gke-dns-discovery`.
- Worktree: `.worktrees/T-0125-gke-dns-discovery`.
- The dirty primary checkout remains protected and untouched.

## Acceptance Boundary

1. Preserve every observable criterion, RED-first case, documentation duty,
   risk, and exclusion in the authoritative T-0125 plan slice.
2. Create runtime, tests, metadata, README, and reference only under
   `packages/deployment-gke/**`, plus the minimum existing Server assembly hook
   proven necessary by RED evidence.
3. Treat GKE readiness/headless-Service DNS as membership authority. Do not use
   a leased registry, registrar, Kubernetes API watch, or public-address
   inference.
4. Preserve exact refresh/TTL/failure precedence, complete address snapshots,
   canonical node identity/TLS authority, IPv6 handling, cancellation, and
   no-leak shutdown semantics.
5. Prove 40 addresses are all used with expected count 32, bounded connection
   starts, scale zero/return, address reuse fencing, unary routing, and durable
   subscription reconciliation.
6. Do not add Terraform, autoscaling policy, Cloud Logging, multiple Gateways,
   Cloud Run, npm publication, or JVM build work.

## Required Gates

- The approved Wave 7 architecture pass is sufficient; no new splitter pass is
  needed because no public decision is unresolved.
- One existing implementer owns all overlapping production files and keeps
  focused RED/GREEN evidence.
- Style/maintainability, documentation, TypeScript/API docs, and
  performance/reliability receive recorded dispositions in one review wave.
- Dedicated per-task security is N/A: DNS/service names and private endpoints
  are trusted operator/platform configuration, and no authentication boundary
  changes.
- Run `pnpm verify:release` after convergence, merge through a clean integration
  worktree, post-merge verify, push `main`, and remove completed branches and
  worktrees.
- Push every feature-branch commit to `origin` immediately.

## Integration Readiness

- All four specialist review concerns are clean after the recorded correction
  and focused re-review waves. Dedicated per-task security remains N/A for the
  recorded trust-boundary reason.
- The final `pnpm verify:release` passes 198 test files with 3 skipped and 3,953
  tests with 26 skipped. Coverage is 94.07% statements, 90.15% branches, 94.57%
  functions, and 95.10% lines.
- The task branch is ready for clean integration, post-merge verification, and
  remote synchronization of `main`.
