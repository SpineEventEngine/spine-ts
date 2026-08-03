# T-0096: Compose and Kubernetes deployment topology

Status: Complete; ready for integration
Start: `2026-08-03`
Baseline: `0e06800b`
Branch: `task/T-0096-compose-kubernetes`
Worktree: `.worktrees/T-0096-compose-kubernetes`
Parent: `T-0089`

Classification: High-risk. This task assembles production-facing multi-process
topologies around persistent subscription ownership, authentication, shared
application storage, graceful shutdown, and container networking.

## Objective

Provides deterministic Docker Compose acceptance for combined and two-gateway,
two-application standalone deployments, plus minimal storage-neutral Kubernetes
references that preserve the approved Wave 5 lifecycle and trust boundaries.

## Human-Imposed Requirements Ledger

- Support combined and standalone gateway modes for small production; require
  standalone gateway mode when application replicas are multiplied.
- Prove two gateway replicas and two application replicas.
- Keep the durable subscription registry across gateway redeployments and use
  one shared registry namespace for all gateway replicas.
- Use exactly one in-memory simple delivery server. Do not add Redis,
  Hazelcast, durable delivery-server modes, or Spine JVM builds.
- Application code selects its storage. Deployment configuration may supply
  endpoints and secrets but must not select Datastore, MySQL, or another
  provider. Acceptance may use the Datastore emulator.
- Do not add application health endpoints by default. Kubernetes references use
  TCP startup/readiness probes and no default liveness probe.
- Preserve best-effort update semantics: reconnect and authoritative re-query
  are required; cross-node notification completeness remains Wave 6 scope.
- Build and test images locally. Publish neither packages nor images.
- Do not add Helm, an operator, a deployment CLI, an unrestricted HTTP router,
  or a new application runner abstraction.
- Preserve protected human-review files and unrelated user work. Push every
  feature-branch commit immediately.

## Acceptance Criteria

1. One command starts and accepts the combined topology with Envoy, one
   combined application/gateway process, explicit durable registry state, and
   exactly one simple delivery server.
2. One command starts and accepts the standalone topology with Envoy, two
   gateways, two Message Board application replicas sharing the same
   application-selected storage, one registry namespace, shared session
   configuration, and exactly one simple delivery server.
3. End-to-end acceptance covers authenticated Post, Query, Subscribe, Activate,
   Cancel, reconnect/re-query, gateway loss and takeover, restart preservation,
   cancellation fencing, bounded shutdown, and missing registry fail-closed.
4. Acceptance uses the locked JVM-compatible service descriptors without
   building or launching Spine JVM.
5. Tests remove containers, networks, volumes, listeners, streams, and temporary
   state within bounded time.
6. Minimal Kubernetes references cover combined and standalone modes, Envoy,
   one simple delivery server, ConfigMap/Secret references, graceful
   termination, TCP startup/readiness, and no liveness probe. They remain
   storage-neutral and pass deterministic render/schema/policy checks.
7. Relevant specialist review, focused verification, Compose validation, and
   post-merge verification converge before integration and remote closure.

## Planning Disposition

The approved F1 contract in
`build-protocol/planning/WAVE_5_EXECUTION_SPLIT.md` already provides the
dependency split, ownership, RED behaviors, exclusions, and verification gate.
No new subsystem or unresolved architecture decision exists, so a second
requirements-splitter pass would duplicate accepted planning and is not
invoked.

## Implementation Owner Dispatch

- Existing role: `implementer`.
- Owned scope: `examples/message-board/deploy/compose/**`,
  `examples/message-board/deploy/kubernetes/**`, topology/manifest acceptance
  harnesses, focused deployment notes, and only the smallest framework defect
  correction demonstrated by those tests.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: medium.
- Both fields must be explicit in dispatch. The owner must not spawn subagents,
  touch protected human-review files, build Spine JVM, publish artifacts, or
  enter final Wave 5 closure documentation owned by T-0097.

## Review Assignments

- Style/maintainability: existing reviewer, expected `gpt-5.6-terra` / high.
- Documentation completeness: existing reviewer, expected `gpt-5.6-luna` /
  medium.
- TypeScript/API docs: existing reviewer, expected `gpt-5.6-terra` / high.
- Performance/reliability: existing reviewer, expected `gpt-5.6-terra` / high.
- Final security remains the parent Wave 5 T-0097 release-readiness gate.

Runtime metadata is recorded when exposed. Otherwise the immutable configured
role/profile and the surface limitation are the acceptance evidence. A missing
explicit dispatch field, visible mismatch, or inherited-profile fallback
requires redispatch.

## Verification Strategy

Run Docker/Compose/loopback capability checks first, then focused topology and
manifest tests, Compose configuration validation, changed-source coverage when
applicable, and the cheap `verify:task` preflight. T-0097 owns the single final
repository-wide `verify:release` run.
