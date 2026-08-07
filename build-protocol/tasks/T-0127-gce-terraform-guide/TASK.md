# T-0127: GCE Terraform And Beginner Deployment Guide

Status: Integrated and post-merge verified

## Objective

Provides editable Terraform and a beginner guide for deploying the supported
one-Gateway GCE topology, scaling identical application nodes in a managed
instance group, replacing an application version, rolling back, and removing
the deployment safely.

The authoritative acceptance contract is T-0127 in
`build-protocol/planning/WAVE_7_SCALING_REDEPLOYMENT_PLAN.md`.

## Classification

High-risk. The task defines production networking, leased discovery,
autohealing, optional autoscaling, replacement behavior, external secret
references, and public operational guidance. The approved Wave 7 architecture
and integrated T-0124 registry runtime resolve the design, so no new
requirements-splitter pass is needed.

## Human-Imposed Requirements Ledger

1. Supply detailed beginner guidance and editable infrastructure-as-code for
   GCE; explain simple and larger production layouts gradually.
2. Deploy exactly one standalone Gateway. Multiple Gateways and Cloud Run are
   outside Wave 7.
3. Run identical application nodes in a GCE managed instance group. Each ready
   process registers its private endpoint through the durable leased registry;
   one Gateway reads complete registry snapshots.
4. Keep the registry durable and shared through the application-configured
   storage factory/namespace. Infrastructure passes references and settings but
   never chooses MySQL, Datastore, or another application storage engine.
5. Support operator-owned scaling of the same version, including zero nodes and
   recovery. Optional autoscaling is disabled by default and requires explicit
   metrics, thresholds, and minimum/maximum capacity.
6. Document that CPU, load-balancing utilization, and per-instance metrics
   cannot recover a group from zero; scale-from-zero requires a whole-group
   Monitoring metric or an explicit operator action/schedule.
7. Document compatible rolling replacement and incompatible
   stop-all/start-new replacement. Pending Inbox work may execute under the new
   business logic; there is no compatibility handshake.
8. Keep one in-memory simple delivery server. A minimal layout may colocate it
   with the Gateway; production guidance recommends separate failure and
   resource boundaries and never calls it durable or highly available.
9. Keep application, delivery, and Gateway listeners private. Provide stable
   private reachability and firewall/health-check configuration without
   creating the operator's public TLS/authentication edge.
10. Terraform may pass external secret identifiers but must not contain secret
    values, write them into state, or implement an identity provider.
11. Include prerequisites, immutable images, configuration, verification,
    manual and automatic scaling, scale to/from zero, rolling and stop-all
    replacement, Gateway interruption, rollback, troubleshooting, and teardown.
12. Do not add Cloud Run, multiple Gateways, Cloud Logging, package publication,
    JVM builds, or pushes to the migration remote.
13. Preserve unrelated user work and push every feature-branch commit to
    `origin` immediately.

## Baseline And Isolation

- Baseline: `origin/main@d5dc9864`, with T-0126 integrated, post-merge
  verified, and remotely synchronized.
- Branch: `task/T-0127-gce-terraform-guide`.
- Worktree: `.worktrees/T-0127-gce-terraform-guide`.
- The dirty primary checkout remains protected and untouched.

## Acceptance Boundary

1. Own `packages/deployment-gce/terraform/**`, package guide/examples, a
   deterministic Terraform policy test, package payload metadata, and only the
   root guide link needed for discoverability.
2. Begin with failing policy/documentation tests for a regional application
   managed instance group, one Gateway, one simple delivery server, private
   networking, stable internal endpoints, autohealing, registry inputs,
   disabled-by-default autoscaling, external secret references, and prohibited
   Cloud Run/storage-engine selection.
3. Use immutable image references and startup/configuration seams that call the
   integrated GCE registrar after listener readiness and configure Gateway
   discovery against the same registry namespace/storage reference.
4. Avoid `target_size` fighting an enabled autoscaler. When autoscaling is off,
   Terraform owns manual application capacity; when it is on, GCE owns capacity.
5. Teach the 20-second renewal, 60-second expiry, 10-second Gateway refresh,
   stable node identity, registration fencing, crash expiry, finite cleanup,
   and scale-to-zero behavior in plain language.
6. Validate current GCE and Google Terraform provider claims against official
   sources and record the evidence in the work log.
7. Do not change runtime TypeScript unless a confirmed mismatch blocks the
   documented topology. Any runtime, dependency, generated, or shared-build
   change promotes final verification to `verify:release`.

## Required Gates

- One existing implementer owns all overlapping Terraform, examples, tests,
  package metadata, and guide files. Expected explicit profile:
  `gpt-5.6-terra` / `medium`.
- Style/maintainability, documentation, TypeScript/API docs, and
  performance/reliability receive one recorded review-wave disposition.
- Dedicated per-task security review is deferred to the Wave 7 release gate;
  deterministic policy tests still prove private topology and
  secret-reference-only inputs.
- Run the cheap preflight, then
  `pnpm verify:task -- --no-coverage packages/deployment-gce/test/terraform-policy.test.ts`
  if the diff remains infrastructure/docs-only.
- Merge through a clean integration worktree, post-merge verify, push `main`,
  and remove completed task/integration branches and worktrees.
