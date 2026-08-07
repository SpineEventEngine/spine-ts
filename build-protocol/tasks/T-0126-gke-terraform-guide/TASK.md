# T-0126: GKE Terraform And Beginner Deployment Guide

Status: Ready for integration

## Objective

Provides editable Terraform and a beginner guide for deploying the supported
one-Gateway GKE topology, scaling identical application nodes, replacing an
application version, rolling back, and removing the deployment safely.

The authoritative acceptance contract is T-0126 in
`build-protocol/planning/WAVE_7_SCALING_REDEPLOYMENT_PLAN.md`.

## Classification

High-risk. The task defines production deployment topology, external secret
references, readiness, operator-controlled autoscaling, replacement behavior,
and public operational guidance across the Gateway, application nodes, and
simple delivery server. The approved Wave 7 architecture pass resolves the
design, so no new requirements-splitter pass is needed.

## Human-Imposed Requirements Ledger

1. Supply detailed beginner guidance and editable infrastructure-as-code for
   GKE; the guide defines the feature set and must answer each deployment
   question in plain language.
2. Deploy exactly one standalone Gateway for the multi-node topology. Multiple
   Gateways and interruption-free Gateway replacement are outside this task.
3. Use GKE headless-Service DNS for application-node discovery. Do not add a
   leased registry, Kubernetes watch, or one-Gateway-per-node topology.
4. Support operator-managed scaling of the same application version, including
   zero nodes and recovery. Spine TS must not change replica counts itself.
5. Optional autoscaling is disabled by default. Operators choose metrics,
   thresholds, and minimum/maximum capacity; scale from zero cannot depend only
   on application-node CPU.
6. Document compatible rolling replacement and incompatible stop-all/start-new
   replacement. Pending Inbox work may execute under the new business logic;
   the framework adds no compatibility handshake.
7. Document that Gateway replacement interrupts clients. Durable subscriptions
   survive; clients reconnect and re-query.
8. The application chooses and configures its storage. Terraform must not
   select MySQL, Datastore, or another storage engine.
9. Templates may reference operator-managed secrets but must not contain secret
   values or create an identity-provider implementation.
10. Include one simple in-memory delivery server, readiness, private
    networking, configuration, verification, rollback, troubleshooting, and
    teardown.
11. Do not add Cloud Run, GCE, Cloud Logging, package publication, JVM build
    work, or changes to the migration remote.
12. Preserve unrelated user work and push every feature-branch commit to
    `origin` immediately.

## Baseline And Isolation

- Baseline: `origin/main@c6ff000c`, with T-0125 integrated, post-merge
  verified, and remotely synchronized.
- Branch: `task/T-0126-gke-terraform-guide`.
- Worktree: `.worktrees/T-0126-gke-terraform-guide`.
- The dirty primary checkout remains protected and untouched.

## Acceptance Boundary

1. Own `packages/deployment-gke/terraform/**`, the package's beginner guide and
   examples, the deterministic Terraform policy test, and only the root guide
   link needed for discoverability.
2. Begin with failing policy/documentation tests, then add Terraform that
   validates one Gateway, one simple delivery server, an application
   Deployment, a headless Service, readiness, private networking,
   configuration, and secret references.
3. Keep autoscaling optional and disabled by default. Its inputs expose the
   operator's metric, threshold, minimum, and maximum choices without implying
   framework-controlled scaling.
4. Teach prerequisites, inputs, `init`, `plan`, `apply`, verification, manual
   scaling, scale to zero and return, compatible and incompatible replacement,
   rollback, troubleshooting, and teardown in a gradual beginner sequence.
5. Verify current Terraform, Kubernetes, and Google Cloud claims against
   official sources and record the evidence in the work log.
6. Do not change runtime TypeScript unless a proven documentation/example
   mismatch requires it; any runtime, dependency, generated, or shared-build
   change promotes final verification to `verify:release`.

## Required Gates

- One existing implementer owns all overlapping Terraform, tests, and guide
  files. Expected explicit profile: `gpt-5.6-terra` / `medium`.
- Style/maintainability, documentation, TypeScript/API docs, and
  performance/reliability receive one recorded review-wave disposition.
- Dedicated per-task security review is deferred to the Wave 7 release gate;
  deterministic policy tests must still prove secret-reference-only inputs and
  private application-node topology.
- Run the cheap preflight, then
  `pnpm verify:task -- --no-coverage packages/deployment-gke/test/terraform-policy.test.ts`
  if the diff remains infrastructure/docs-only. Review proved that dynamic
  discovery is not admitted through the standalone Server path, so the bounded
  runtime correction promotes final verification to `pnpm verify:release`.
- Merge through a clean integration worktree, post-merge verify, push `main`,
  and remove completed branches and worktrees.
