# T-0063: Production Delivery Scheduler And Supervisor

Status: Awaiting specialist review

Branch: `task/T-0063-delivery-scheduler-supervisor`

Worktree: `.worktrees/T-0063-delivery-scheduler-supervisor`

Baseline: pushed and post-merge-verified `main` at `f2558ec5`

## Objective

Add the production scheduler and supervisor that coordinate bounded concurrent
delivery drains over the accepted T-0061 `Delivery` runtime and T-0062 remote
ports. This packet owns scheduling and supervision only; the in-memory
delivery server begins in T-0064.

## Classification

High-risk. The packet changes distributed-concurrency orchestration,
lease/session lifecycle, cancellation, shutdown fencing, resource bounds, and
public runtime behavior across the server and delivery-client boundary.

## Acceptance Criteria

- At most one drain per shard/process is active. Notifications received during
  a run coalesce into exactly one follow-up drain.
- Global concurrency and pending-shard storage are finite. Known shards stay
  coalesced at capacity; an unseen shard is not retained and sets one bounded
  `rescanRequired` condition without evicting active work.
- Available capacity and periodic recovery/rescan rediscover skipped work, so
  overflow cannot silently lose eventual recovery.
- One supervisor owns scheduler start/stop, bounded cancellable Admin-watch
  restart through T-0062, periodic recovery/rescan, and stale-session recovery.
- Close stops admission and propagates abort/deadline through scheduler, loop,
  endpoint/RPC, and lease work. Grace expiry fences active epochs, stops lease
  renewal, attempts session release, reports a structured sanitized shutdown
  timeout, and rejects late results.
- A later close retry resumes retained cleanup without duplicating completed
  work. All queues, timers, retry state, and shutdown waits remain bounded.
- Structured failures expose no payload or actor metadata.
- T-0064 server state/services, T-0065 standalone configuration, T-0066
  multi-process parity, Redis, Hazelcast, durable delivery-server persistence,
  and Wave 3 TS/JVM live compatibility remain out of scope.

## Required Test-First Evidence

Use deterministic fake-clock RED/GREEN slices for same-shard storms,
distinct-shard storms, overflow/rescan, close during queued work, Admin-watch
restart, stale recovery, lease loss, permanently blocked endpoints,
post-timeout fencing, detached late settlement, cleanup retry, and explicit
resource-bound assertions. Run focused T-0061/T-0062 regressions and the full
repository gate after review convergence.

## Human-Imposed Requirements Ledger

- Wave 1 continues autonomously until complete or a real protocol/environment
  blocker is documented.
- Report high-level feature progress at least every 30 minutes and report every
  child result, verification, review, commit, push, merge, or blocker
  immediately.
- Push every commit to `origin` immediately; after task closure push both task
  branch and `main` and prove ref equality.
- Preserve the accepted idiomatic TypeScript feature parity without speculative
  over-engineering or blind JVM copying.
- Delivery must support production scheduling/supervision and later
  multi-machine topology compatible with the frozen delivery-server contract.
- Only the upstream `simple-server` is in Wave 1; its TypeScript counterpart is
  in-memory only. Redis and Hazelcast are excluded.
- Live TS/JVM compatibility tests are postponed to Wave 3; human-facing admin
  UI/TUI is postponed to Wave 4.
- Use isolated worktrees, TDD, existing project roles, explicit prescribed
  model/reasoning profiles, and preserve unrelated user files. Never read or
  modify `human-review-1-jul.md`.

## Architecture Evidence

- Frozen Wave plan: `build-protocol/planning/WAVE_1_JVM_PARITY_PLAN.md`, T-0063
  and its high-risk assumptions.
- Local JVM research: `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`,
  especially delivery ownership, shard locking, finite page runs, release,
  late-notification follow-up, and monitor-driven retry semantics.
- Corresponding JVM source paths identified by the local notes:
  `server/.../delivery/Delivery.java`, `ShardedWorkRegistry.java`,
  `AbstractWorkRegistry.java`, `DeliveryMonitor.java`, and
  `RepeatDispatching.java`. No local core-java checkout is present in this
  worktree, so the frozen local research is the available source-derived
  evidence for this packet.
- Implementation impact: keep one small scheduler/supervisor contract over the
  existing delivery ports; do not recreate JVM executors, overloads, or an
  additional storage abstraction.

## Library Selection

- Checked the repository package graph and lockfile; no concurrency queue
  library is currently installed.
- Checked the maintained ESM/TypeScript candidates `p-queue` 9.3.3 and
  `p-limit` 7.3.1 through their current npm metadata and upstream repositories.
  Both support the repository's Node 24 floor.
- Neither candidate owns the task's actual invariant: per-shard coalescing,
  active-shard retention, one bounded distinct-shard overflow flag, recovery
  rescan, epoch fencing, and retryable shutdown cleanup. `p-limit` supplies
  only a counter; `p-queue` adds queue policy while still requiring the complete
  shard state machine.
- Decision: add no dependency. Use Node's `AbortController` and timers plus a
  small bounded `Map`/`Set` state owner. This is less infrastructure and keeps
  the accepted semantics visible and directly testable.

## Skill Applicability

- Session inventory and `build-protocol/skills/EXPECTED_SKILLS.md` were checked.
  The full readable `~/.agents/skills` entrypoint list and
  `~/.agents/.skill-lock.json` were inspected on 2026-07-23.
- Selected and fully read: `subagent-driven-development`,
  `executing-plans`, `using-git-worktrees`, `test-driven-development`,
  `requesting-code-review`, and `verification-before-completion`.
- Relevant project-local protocol overrides skill defaults where they differ:
  existing project roles and selective concern lanes replace generic reviewer
  roles; commits are orchestrator-owned and pushed immediately; the recent
  verified `main` evidence replaces a duplicate baseline full suite.
- `architecture-patterns`, `domain-modeling`, and `nodejs-backend-patterns`
  were metadata-triaged but not selected: the accepted Wave plan already fixes
  the architecture and this packet should not broaden it.

## Requirements Splitter Assignment Gate

- Existing role: `requirements_splitter`.
- Scope: read-only decomposition of the accepted T-0063 behavior into bounded
  implementation slices, public/internal seams, invariants, and tests; no
  edits, child agents, commits, pushes, or merges.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: `high`.
- Both fields must be explicit in dispatch. Runtime metadata is recorded when
  exposed; otherwise the immutable configured role/profile and surface
  limitation are the evidence.

## Implementer Assignment Gate

- Existing role: `implementer`.
- Ownership: the bounded server scheduling/supervision modules, focused tests,
  affected public docs/TSDoc/API inventory, and task records authorized by the
  accepted split.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both fields must be explicit in dispatch. The child may not spawn children,
  commit, push, merge, or modify protected/unrelated files.

## Accepted Requirements Split

Runtime self-introspection was unavailable. The accepted immutable configured
assignment was the existing `requirements_splitter`, explicitly
`gpt-5.6-sol` / `high`, with no visible fallback or mismatch. It reported no
blocker and established this implementation sequence:

1. Add one package-internal controlled-run handle with an abort controller,
   deadline, epoch fence, observed late settlement, stopped lease renewal, and
   checkpointed retryable release cleanup. Keep public `Delivery.run()`
   unchanged and source-compatibly add operation options to existing delivery
   ports.
2. Add one internal scheduler with disjoint bounded active/pending maps, one
   follow-up bit per active shard, one bounded overflow-rescan bit, and no
   per-shard timer.
3. Add one public `DeliverySupervisor` and structural source port over existing
   T-0062 method names. It owns one Admin iterator, bounded watch restart,
   coalesced snapshot/recovery, stale-session release, and periodic rescan.
4. Add bounded close: stop admission, cancel watch/timers, grace-wait, fence
   active epochs, stop renewal, attempt release, report one sanitized
   `DeliveryShutdownTimeoutError`, and retain only incomplete cleanup for a
   later close retry.
5. Integrate local inbox notification, declarations, environment ownership,
   README/user-guide snippets, API inventory, and resource-bound tests.

The server package must not depend on `@spine-ts/delivery-client`; the public
source port is structural, and a `DeliveryClient` satisfies it directly. Do
not add a public scheduler, generic job/executor layer, durable supervisor
state, new wire cursor/session identity, or another storage abstraction.

### Exclusive implementation ownership

There is one production writer in this task worktree. The implementer is
explicitly authorized to create or modify only these behavior-owned paths:

- new `packages/server/src/delivery/delivery-run-control.ts`,
  `delivery-scheduler.ts`, and `delivery-supervisor.ts`;
- mirrored new tests under `packages/server/test/delivery/`;
- narrow changes to `packages/server/src/delivery/delivery.ts`,
  `delivery-loop.ts`, `delivery-ports.ts`, and `delivery-builder.ts`;
- narrow changes to `packages/delivery-client/src/remote/adapters.ts` and the
  minimum existing client type/export surface needed for structural operation
  options;
- narrow notification/lifecycle wiring in
  `packages/server/src/context/local-inbox-handoff.ts`,
  `packages/server/src/server/server-environment.ts`, and their directly
  affected tests;
- `packages/server/src/index.ts`, `scripts/check-api-docs.mjs`,
  `packages/server/README.md`, `packages/delivery-client/README.md`, and
  `docs/USER_GUIDE.md` for the exact new public contract and snippets;
- this task's `IMPLEMENTATION_REPORT.md` and `build-protocol/work-logs/T-0063.md`.

No other agent owns or edits those paths concurrently. Existing older
environment delivery coordinator/worker modules are read-only dependencies and
must not be refactored. Projection code, generated output, unrelated records,
and `packages/client/codegen/generate-projection-columns.mjs` remain excluded.

## Required Review Dispositions

- Style/maintainability: required.
- Documentation completeness: required.
- TypeScript/API compatibility: required.
- Performance/reliability: required, with concurrency/lifecycle emphasis.
- Final security: N/A for this packet; reserved for T-0067 unless a
  security-critical blocker requires escalation.
