# T-0094: Environment-owned remote delivery

Status: Specialist review active
Start: `2026-08-02`
Baseline: `c618e6da`
Branch: `task/T-0094-remote-delivery`
Worktree: `.worktrees/T-0094-remote-delivery`
Parent: `T-0089`

Classification: High-risk. This task changes public environment configuration,
cross-package lifecycle assembly, remote transport ownership, failure cleanup,
and retry behavior.

## Objective

Allows one application configuration to install the existing remote delivery
facility into `ServerEnvironment`, while the environment opens and closes the
client, inbox adapters, removal quarantine, and related attachments in the
established lifecycle order.

## Human-Imposed Requirements Ledger

- Reuse `DeliveryClient`, `RemoteInbox`, `RemoteWorkRegistry`,
  `DeliveryBuilder`, `ServerEnvironmentSettings`, and existing attachment
  lifecycle. Do not invent another runner, worker, supervisor, transport, or
  provider-selection abstraction.
- Configuration must open before listener intake and fail without leaked
  clients, streams, or attachments.
- Environment closure must stop intake and attachments before delivery,
  client, quarantine, transport, tracing, and storage. Repeated, concurrent,
  and partially failed close attempts remain bounded and retry only unfinished
  phases.
- Keep the simple delivery server's existing gRPC Health service unchanged. Do
  not add an application health endpoint.
- Use only the in-memory simple delivery server. Redis, Hazelcast, and durable
  delivery-server modes remain excluded.
- Do not build, launch, patch, or vendor Spine JVM.
- Preserve application-owned storage selection and avoid a package dependency
  cycle: `delivery-client` already depends on `server`, so `server` must not
  depend on `delivery-client`.
- Follow strict RED/GREEN TDD, keep one production writer, aggregate one
  relevant review wave, and push every commit to origin immediately.
- Never read, edit, stage, move, or delete either protected `human-review`
  file.

## Acceptance Criteria

1. One explicit application configuration supplies the remote delivery
   endpoint and required durable removal-quarantine collaborator, producing the
   existing environment delivery facility without repeated adapter wiring.
2. Required configuration opens before server listener intake. An open failure
   leaves no client, stream, or attachment and a retry starts from a clean
   state.
3. Environment shutdown observes the approved dependency order and owns each
   configured resource exactly once.
4. Concurrent/repeated close and partial failures remain bounded and retry only
   unfinished phases.
5. Existing local delivery configuration remains compatible. No new health API,
   delivery server mode, worker/supervisor, provider selector, or package cycle
   is introduced.
6. Public TSDoc and beginner/agent package documentation explain configuration,
   startup failure, ownership, closure, and limitations with current snippets.

## Skills And Dispatch Record

- Session inventory source: Codex Desktop skill catalog. Installed-entrypoint
  check: `find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
  Expected manifest and `~/.agents/.skill-lock.json` were readable.
- Selected `using-git-worktrees`, `subagent-driven-development`, and
  `test-driven-development`; their `SKILL.md` files were read completely.
- Repository worktree, durable-log, role, review-wave, and closure rules replace
  conflicting skill instructions that refer to `.superpowers`, generic task
  reviewers, or absent branch-finishing skills. The user previously required
  `.superpowers` removal, so no such ledger is created.
- `requesting-code-review` and `verification-before-completion` are deferred to
  their actual review/closure stages. General backend, advanced-type, planning,
  and ADR skills are N/A because the frozen D1 boundary reuses existing
  contracts and the project requirements splitter owns the necessary design
  refinement.

## Requirements Splitter Dispatch

- Existing role: `requirements_splitter`.
- Scope: freeze the smallest cycle-free public configuration and ownership
  contract, map RED lifecycle tests and file ownership, identify task-relevant
  Spine JVM server notes/source to inspect without building JVM, and define
  focused preflight/review/release gates.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: high.
- Both fields are explicit in the dispatch. Runtime metadata will be recorded
  when exposed; otherwise the immutable configured role/profile and limitation
  are acceptance evidence.

## Verification Strategy

Use focused delivery-client/server lifecycle tests and changed-source coverage
during implementation. After cheap preflight and one converged relevant review
wave, run `verify:release` once because the task changes shared runtime and
public lifecycle assembly.

## Requirements Split Result

- Accepted split: `build-protocol/planning/T-0094_REMOTE_DELIVERY_SPLIT.md`.
- Existing role: `requirements_splitter`.
- Expected profile was explicit in dispatch: `gpt-5.6-sol` / high reasoning.
- Runtime model/reasoning self-introspection was not exposed by the execution
  surface; the immutable configured role/profile and explicit dispatch are the
  available acceptance evidence.
- Frozen boundary: a generic openable delivery lifecycle port remains in
  `server`; endpoint, client, adapters, builder wiring, and quarantine ownership
  remain in `delivery-client`, preserving the existing dependency direction.
- No current blocker. Implementation proceeds with the exact RED matrix,
  ownership order, paths, and gates in the accepted split.

## Orchestrator Acceptance Correction

- Corrected the splitter's test paths to the required mirrored `test/` trees;
  production tests may not be co-located under `src/`.
- Replaced the proposed exported standalone factory with
  `RemoteDelivery.connectTo(RemoteDeliveryConfig)`. The remote facility owns
  state and lifecycle, so behavior belongs to that named type under the
  project's declaration rules.
- These corrections do not alter the cycle-free dependency seam, lifecycle
  order, RED behaviors, or verification boundary.

## Implementation Owner Dispatch

- Existing role: `implementer`.
- Owned scope: every exact path in the accepted split, with the two corrected
  test paths. `environment-attachment.ts` remains read-only unless a RED test
  proves the documented minimum change is required.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: medium.
- Both fields must be explicit. Runtime metadata will be recorded when exposed;
  otherwise the immutable configured role/profile and limitation are evidence.

## Requirements Boundary Reopened

- Pre-review acceptance inspection found that the remote owner constructs a
  `Delivery` with `RemoteInbox` and `RemoteWorkRegistry`, but the environment's
  attachment generation still creates its existing local delivery worker. The
  remote facility is therefore opened and closed without driving application
  delivery work.
- Lifecycle-only tests do not satisfy the objective that one configuration
  produces the existing environment delivery facility without manual adapter
  wiring. Review and release verification remain blocked on a focused
  architecture correction and behavior test proving the remote ports are used.
- The existing requirements splitter is redispatched with explicit
  `gpt-5.6-sol` / high reasoning to choose the minimum internal worker-factory
  seam while preserving `delivery-client -> server` dependency direction and
  the public `RemoteDelivery.connectTo()` shape where possible.

## Functional Wiring Resolution

- The corrective splitter dispatch used the explicit existing
  `requirements_splitter`, `gpt-5.6-sol` / high profile but produced no artifact
  or blocker within its bounded interval and was interrupted. Runtime
  self-introspection was unavailable and no result is accepted from it.
- The first corrective handoff revealed that the finite worker deliberately
  uses the internal `Delivery`, not `DeliveryBuilder`; the implementer stopped
  without changes rather than widening the refactor.
- The orchestrator then froze the smaller port seam:
  `ServerEnvironmentDelivery` exposes the existing `DeliveryInbox` and
  `DeliveryWorkRegistry` interfaces after open. The current internal finite
  constructor and current supervisor builder each receive the same ports.
- `RemoteDelivery` publishes its client-backed adapters after readiness and
  injects them through that seam. It no longer builds or reflectively closes a
  `Delivery`, which has no close contract.
- The existing implementer is redispatched with the complete RED/GREEN
  correction batch and the same explicit `gpt-5.6-terra` / medium profile.
