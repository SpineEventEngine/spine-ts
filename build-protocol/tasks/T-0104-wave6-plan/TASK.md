# T-0104: Wave 6 Distributed Delivery And Stand Plan

Status: Complete

## Objective

Freezes the approved Wave 6 decisions and produces a dependency-ordered,
autonomously executable plan for JVM-familiar sharded delivery, configurable
durable Stand subscriptions, multi-node gateway attachment, and the Distributed
Message Board example.

This task plans Wave 6. Runtime implementation starts only in the child tasks
created by the accepted plan.

## Classification

High-risk. Wave 6 changes serialized records, persistence, concurrent shard
ownership, delivery idempotency, lifecycle cleanup, subscription propagation,
and topology across the server, storage, delivery, and browser gateway packages.

## Baseline And Isolation

- Baseline: `origin/main@59fb286c`.
- Branch: `task/T-0104-wave6-plan`.
- Worktree: `.worktrees/T-0104-wave6-plan`.
- The primary checkout is coordination-only and its existing dirty files are
  outside this task.

## Acceptance Criteria

- The plan explains the current implementation gaps from source evidence.
- It defines serialized and public contracts before their consumers.
- It assigns one production writer per dependency-ordered task.
- Each child task has observable behavior, RED-first tests, review concerns,
  documentation obligations, and an appropriate verification profile.
- It updates the completion plan so the former Wave 6 becomes Wave 7.
- It contains no JVM build step and introduces no speculative Redis, Hazelcast,
  durable delivery-server, or package-publication work.

## Human-Imposed Requirements Ledger

1. Delivery must provide the JVM-style guarantee that one Entity is updated on
   one application node at a time. A posted command is routed, persisted to an
   Inbox, and dispatched only by the node that acquires the relevant shard.
2. A shard notification fans out through the simple delivery server. Each
   application node may attempt the shard, but only the lease owner drains all
   Inbox messages for that shard until none remain.
3. Aggregates and Process Managers use the same Inbox delivery foundation.
   Process Managers may handle commands through `@Assign` as well as events.
4. `Stand` observes the EventBus. It propagates event subscriptions directly
   and Entity subscriptions through `EntityStateChanged` system events.
5. The registry beneath `Stand` is configurable. Its built-in durable form uses
   the Bounded Context's configured `StorageFactory` by default. A
   BoundedContext builder may instead receive a completely custom registry
   implementation.
6. An in-memory Stand registry remains valid. Production emits a WARN-level
   message rather than failing when that registry is selected.
7. Nodes reconcile the durable subscription registry from a complete snapshot
   every 10 seconds. They do not poll Entity state.
8. Pending subscription activation expires after 30 seconds. Every application
   node runs the same finite, idempotent cleanup.
9. Cancellation physically deletes the durable subscription by default.
   Cancellation completes after durable deletion and Gateway-side stream stop;
   it does not wait for every application node to observe the deletion.
10. One standalone Gateway connects as a gRPC client to the fixed configured
    set of application nodes. Multi-instance deployment does not require one
    Gateway per application node. Dynamic node discovery belongs to Wave 7.
11. Subscription notifications remain best effort and queries remain
    authoritative. Wave 7 will separately address stronger horizontal
    semantics and application redeployment/update behavior.
12. Add a Distributed Message Board in addition to the existing simple Message
    Board. It has the same domain behavior and UI with a two-node application,
    standalone Gateway, and in-memory simple delivery server topology.
13. Update every affected README, reference, guide, architecture document, and
    example after runtime interfaces stabilize. Update all examples to the
    corrected delivery model.
14. Keep `.add(...)` as the Bounded Context Entity registration verb.
15. Use only the in-memory `simple-server`; do not add Redis or Hazelcast.
16. Do not build Spine JVM. Inspect only task-relevant JVM notes/source.
17. Do not publish packages to npm and do not push to the future migration
    remote. Push every feature-branch commit to `origin` immediately.
18. Preserve human-owned files, especially `human-review-1-jul.md`.

## High-Risk Assumptions To Prove

- Existing Inbox persistence can be generalized without parallel Aggregate and
  Process Manager delivery mechanisms.
- A full durable-registry snapshot plus local reconciliation can converge after
  deletion without tombstones and without retaining cancelled subscriptions.
- Gateway fan-in can forward application-node notifications, including possible
  duplicates, while keeping queries authoritative and avoiding a completeness
  promise or unbounded deduplication history.
- Existing storage factories can host subscription records without weakening
  tenant isolation or transaction ownership.

## Skill Applicability

The session inventory, `build-protocol/skills/EXPECTED_SKILLS.md`,
`find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md`, and
`~/.agents/.skill-lock.json` were inspected.

Selected and fully read:

- `using-git-worktrees` for isolated work;
- `implement` and `test-driven-development` for runtime child tasks;
- `subagent-driven-development` for one owner plus task-scoped review;
- `requesting-code-review` and `verification-before-completion` for acceptance.

The `subagent-driven-development` scratch ledger under `.superpowers/` is not
used. The human previously removed that directory, and this repository's task,
work, and review logs are the authoritative durable ledger. Generic ADR,
domain-modeling, CQRS, event-store, backend, and planning skills were not
selected because the frozen human decisions, Spine JVM evidence, and project
protocol are more specific and adding parallel vocabularies would risk
over-engineering.

## Planning Assignment

The existing requirements splitter will receive the frozen ledger, relevant
repository/JVM evidence, and a bounded request to produce the child-task plan.
Expected dispatch: `gpt-5.6-sol` / `high`, explicitly selected. Subagents must
not spawn subagents.

## Review Dispositions

- Style/maintainability: relevant to task sizing and avoidance of parallel
  mechanisms.
- Documentation: relevant because this task changes the active completion plan.
- TypeScript/API docs: relevant to planned public and serialized contracts.
- Performance/reliability: relevant to sharding, persistence, polling, cleanup,
  fan-out, and lifecycle semantics.
