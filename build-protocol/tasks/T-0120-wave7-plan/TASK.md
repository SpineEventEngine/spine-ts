# T-0120: Wave 7 Scaling And Redeployment Plan

Status: Human Q&A complete; implementation not started

## Objective

Records the approved Wave 7 deployment, discovery, scaling, and redeployment
boundaries, resolves the remaining human questions, and then produces a
dependency-ordered implementation plan.

## Classification

High-risk. Wave 7 changes dynamic application-node discovery, Gateway routing
and subscription lifecycle, persisted deployment coordination, failure
behavior, rolling replacement, and production infrastructure templates.

## Baseline And Isolation

- Baseline: `origin/main@e6666605`.
- Branch: `task/T-0120-wave7-plan`.
- Worktree: `.worktrees/T-0120-wave7-plan`.
- The stale and dirty primary checkout remains coordination-only and untouched.

## Human-Imposed Requirements Ledger

1. Cloud Run is outside Wave 7, Wave 8, and the initial offering.
2. Wave 7 supports GKE and GCE, with a detailed beginner-oriented deployment
   guide for each platform.
3. The framework provides generic discovery capability. Platform-specific
   behavior belongs in separate packages.
4. Use `@spine-event-engine/deployment`,
   `@spine-event-engine/deployment-gke`, and
   `@spine-event-engine/deployment-gce` as the package boundaries.
5. One logical standalone Gateway discovers and connects to all current
   application nodes. Multiple Gateways remain Wave 8 work.
6. GKE discovery uses a headless Service and DNS. The Gateway refreshes the
   result on a configurable ten-second interval and respects DNS TTL behavior.
7. GCE discovery uses a storage-backed leased application-node registry. The
   registry receives an explicit `StorageFactory` and uses a separate logical
   namespace, although an application may point it at the same physical
   storage system as domain data.
8. The initial GCE lease policy renews every 20 seconds, expires after 60
   seconds, and lets the Gateway refresh discovery every 10 seconds.
9. The default expected application-node count is 32. Discovery continues to
   use every node when that threshold is exceeded. Load tests document tested
   capacity but do not impose a hard runtime maximum.
10. The minimal GCE Terraform topology may colocate the Gateway and the
    in-memory simple delivery server. Production guidance recommends separating
    them.
11. Supply optional platform autoscaling configuration, disabled until the
    operator selects metrics and thresholds. Spine TS does not perform scaling.
12. Scaling the same application version up and down, including scale to zero,
    is supported. Operators own scaling policy.
13. Compatible business-logic versions may overlap during rolling application-
    node replacement. Incompatible changes use stop-all/start-new replacement.
    Pending Inbox work may execute under the new version.
14. A single Gateway may be replaced in Wave 7 with a documented interruption.
    Durable subscription definitions survive; clients reconnect and re-query.
15. Deployment templates pass configuration and external secret references but
    never select the application's storage engine.
16. Wave 8 owns multiple-Gateway behavior, framework operational logging and a
    Google Cloud Logging adapter, the then-current `validation-ts` upgrade, and
    Datastore/RDBMS physical-layout tuning controls. Its logging work emits an
    ERROR when discovered application nodes exceed the configured expected
    count; Wave 7 continues serving every node.
17. No Wave 7 implementation starts until the human approves the completed
    plan.
18. Do not publish packages to npm or push to the future migration remote.
19. Push every feature-branch commit to `origin` immediately.
20. Preserve user-owned files, especially `human-review-1-jul.md` and
    `human-review-22-jul.md`.
21. Each GCE application process runs its own registrar according to the
    lifecycle in `WAVE_7_SCALING_REDEPLOYMENT_PLAN.md`.
22. GCE publishes a private node address by default and permits an explicit
    endpoint override for nonstandard networking.

## Human Q&A Result

Every Wave 7 product decision is resolved. The final planning step may now
produce and review the dependency-ordered implementation split. Runtime work
still requires the human's explicit approval of that completed plan.

## Review Dispositions

- Style/maintainability: relevant once task boundaries and package ownership
  are frozen.
- Documentation: relevant to the deployment plan and operator guidance.
- TypeScript/API docs: relevant to discovery and registration contracts.
- Performance/reliability: relevant to leases, refresh, bounds, replacement,
  and failure behavior.
