# T-0113: System Context And Payload-First Subscription Plan

Status: Reviewed and ready for integration; implementation not started

## Objective

Freeze an autonomously executable correction plan that gives every domain
Bounded Context one real internal System Context, routes system events only
through its EventBus, keeps system events out of the domain EventBus and domain
EventStore, and makes Message Board consume complete subscription payloads.

## Classification

High-risk. The work changes event persistence, context construction, Stand
observation, durable subscription activation, lifecycle ownership, shutdown,
and system-event semantics across shared server runtime code.

## Baseline And Isolation

- Baseline: `origin/main@c1771a93`.
- Branch: `task/T-0113-system-context-plan`.
- Worktree: `.worktrees/T-0113-system-context-plan`.
- The dirty primary checkout remains coordination-only and untouched.

## Human-Imposed Requirements Ledger

1. Add a real `SystemContext` and route all system events through its EventBus.
2. A system event must never travel through the domain EventBus or be stored in
   the domain EventStore.
3. Emit every copied system event that corresponds to an operation Spine TS
   already supports: entity creation/state/lifecycle changes and accepted
   command/event dispatch.
4. Keep `EventImported` compatibility-only and do not invent event import.
5. Keep `MigrationApplied` dormant until Spine TS has a migration operation.
6. Forget system events by default. Provide a narrow opt-in that persists them
   only in the paired System Context storage namespace.
7. Keep raw System Contexts internal and unavailable to application routing or
   end-user posting.
8. Message Board applies valid entity subscription payloads locally instead of
   querying after every normal update.
9. Message Board queries for initial state, reconnect/gap recovery, malformed
   payload recovery, and once after its own successful post when live updates
   are disconnected.
10. Preserve the durable Stand registry, its existing storage namespace, the
    ten-second reconciliation interval, and all accepted best-effort limits.
11. Do not build or modify Spine JVM.
12. Do not publish to npm or push to the future migration remote.
13. Push every feature-branch commit to `origin` immediately.
14. Preserve user-owned files, especially `human-review-1-jul.md`.

## Approved Decisions

- “All system events” includes all events represented by currently supported
  TS operations, not speculative import or migration features.
- System-event persistence is disabled by default and receives one narrow
  builder-level opt-in.
- A connected Message Board relies on valid subscription contents after a
  successful post. A disconnected board performs one authoritative query.
- Existing accepted policy keeps `SystemContext` internal.

## Planning Evidence

- Spine JVM was inspected read-only at
  `origin/master@461a8281e484c12636d8cf660a1d6c929fbbd7ec`.
- `BoundedContextBuilder` builds `SystemContext` first and gives the domain
  context a system client.
- Domain and system contexts own separate EventBus and Stand instances; their
  Stands share one subscription registry.
- `EntityLifecycle` posts lifecycle events through `SystemWriteSide` to the
  system EventBus.
- JVM system events are forgotten by default and may be persisted separately.
- The JVM project was not built or modified.

## Requirements-Splitter Assignment

- Existing role: requirements splitter.
- Expected and explicitly dispatched model: `gpt-5.6-sol`.
- Expected and explicitly dispatched reasoning: `high`.
- Result: accepted; no files edited and no JVM build performed.
- Runtime metadata: the role surface did not expose independent
  self-introspection, so the immutable configured role/profile is the available
  evidence.

## Deliverable

The approved dependency plan is
[`T-0113_SYSTEM_CONTEXT_PLAN.md`](../../planning/T-0113_SYSTEM_CONTEXT_PLAN.md).
No runtime or example implementation belongs to this planning task.

## Review Dispositions

- Style/maintainability: relevant to task boundaries and avoiding a generic
  dual-bus framework.
- Documentation: relevant to the durable plan and behavior claims.
- TypeScript/API docs: relevant to the planned builder option and internal API
  boundary.
- Performance/reliability: relevant to persistence, post-commit observation,
  subscription fan-out, cleanup, and shutdown order.
