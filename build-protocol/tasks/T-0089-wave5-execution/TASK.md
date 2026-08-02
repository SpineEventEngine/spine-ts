# T-0089: Wave 5 packaging and deployment

Status: Active
Start: `2026-08-02`
Baseline: `9540390f121da37010c48295f67ef63adb11b2aa`
Branch: `task/T-0089-wave5-execution`
Worktree: `.worktrees/T-0089-wave5-execution`

Classification: High-risk. The program changes process lifecycle ownership,
public hosting contracts, persistent subscription coordination, authentication
routing, multi-process topology, and production deployment references.

## Objective

Implements the approved
`build-protocol/planning/WAVE_5_PACKAGING_DEPLOYMENT_PLAN.md` completely through
reviewed, verified, merged, and remotely synchronized dependency-sized tasks.

## Acceptance Criteria

1. `Server.run()` safely owns final `ServerEnvironment` closure under the
   approved exclusive run/start policy.
2. Production combined and standalone gateways use an explicitly configured
   durable subscription registry; two standalone replicas coordinate through
   atomic claims, finite leases, cancellation fences, and bounded retention.
3. The standalone gateway hosts Spine RPC and bounded application auth routes
   and can forward to Spine TS or an unmodified Spine JVM endpoint without
   building Spine JVM.
4. `ServerEnvironment` owns the smallest remote-delivery integration and its
   shutdown without adding a parallel runner abstraction.
5. Applications build once and start without generation or monorepo rebuilds.
6. Local container images, deterministic Compose topologies, and minimal
   Kubernetes references prove combined and two-gateway/two-application modes.
7. Application code selects storage. Infrastructure passes configuration and
   secrets but never selects MySQL, Datastore, or another provider.
8. Human and agent documentation states lifecycle, readiness, authentication,
   durability, and best-effort subscription limits accurately.
9. Every slice passes focused TDD, relevant review, immediate remote pushes,
   integration, and change-sensitive post-merge verification. Final Wave 5
   convergence passes `verify:release` and the production topology acceptance.

## Human-Imposed Requirements Ledger

- Every decision and exclusion in the approved Wave 5 plan is binding.
- Support both combined and standalone gateway modes for small production;
  require standalone mode for multiple application replicas.
- Require durable subscription registry state even for one production gateway
  and test two standalone gateway replicas.
- Use exactly one in-memory `delivery-server/simple-server`; do not add Redis,
  Hazelcast, durable delivery-server modes, or Spine JVM builds.
- Do not add application health endpoints by default. Use the approved TCP
  startup/readiness semantics and no default liveness probe.
- Keep storage selection in application code. A Datastore emulator may be used
  only by acceptance configuration in MessageBoard.
- Build and test packages and images locally. Publish neither npm packages nor
  images; revisit publication only after all accepted waves.
- Do not add a deployment CLI, new application runner abstraction, operator,
  Helm chart, storage-selection framework, or unrestricted HTTP router.
- Reuse current app startup, Proto packaging, registry, Envoy, auth, storage,
  delivery, and MessageBoard foundations before adding a new abstraction.
- Follow test-first implementation. Keep one writer on overlapping production
  files and aggregate one relevant reviewer wave per slice.
- Push every feature-branch commit immediately. Merge, post-merge verify, and
  push `main` after every completed slice.
- Work autonomously under the granted unrestricted permission profile. Do not
  request routine permission for worktrees, Git operations, tests, containers,
  or local services. Stop only for a genuine protocol or external blocker.
- Never read, edit, stage, move, or delete either protected `human-review` file.

## Requirements Splitter Dispatch

- Existing role: `requirements_splitter`.
- Scope: turn the approved ten-step Wave 5 sequence into the smallest safe
  dependency-ordered implementation tasks, with explicit ownership, public
  contracts, RED behavior tests, review concerns, verification profiles, and
  integration boundaries. Identify existing seams to reuse and any true plan
  conflict before implementation.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: high.
- Both fields are explicit in the dispatch. Runtime metadata is recorded when
  exposed; otherwise the immutable configured role/profile and limitation are
  the acceptance evidence.

## Verification Strategy

Each bounded slice uses `verify:task` unless it changes shared runtime/build or
release behavior, in which case it uses `verify:release`. Docker, Compose,
loopback, and multi-process capabilities are checked before the slices that
depend on them. The final Wave 5 task runs the release profile once after all
focused preflight and reviews converge.
