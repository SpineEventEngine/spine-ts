# T-0107: Remote Shard Fan-Out And Drain

Status: In Progress

## Objective

Connects every application node to the simple delivery server's Admin shard
stream. A reported shard is attempted by every node, exactly one remote lease
owner drains its durable Inbox work until empty, and reconnect begins with a
bounded complete shard snapshot before live updates resume.

## Classification

High-risk. This task changes distributed coordination, reconnect behavior,
bounded resource handling, shutdown, remote lease ownership, and multi-process
delivery correctness.

## Baseline And Isolation

- Baseline: `origin/main@ce1ef99e`.
- Branch: `task/T-0107-remote-shard-fanout`.
- Worktree: `.worktrees/T-0107-remote-shard-fanout`.
- The primary checkout is coordination-only. Its unrelated dirty files remain
  outside this task.

## Acceptance Criteria

1. Each attached `ServerEnvironment` observes the delivery server's bounded
   Admin shard snapshot and subsequent shard-update stream.
2. Every node attempts each reported shard, while the remote work registry
   permits only one lease owner to dispatch that shard at a time.
3. The lease owner performs finite delivery runs repeatedly until no
   deliverable Inbox work remains, including work added during a drain, then
   releases the lease.
4. Lease loss stops dispatch under the old ownership fence; another node may
   acquire the shard without duplicate committed Entity effects.
5. Stream reconnect obtains a complete bounded shard snapshot before consuming
   live updates, so a notification lost during disconnection does not strand
   persisted work.
6. Notification buffering is explicitly bounded. Overflow converges through a
   fresh snapshot instead of growing memory without limit or silently
   abandoning durable work.
7. Environment closure cancels snapshot/update reads, pending reconnect work,
   and delivery attempts without leaving a timer, listener, or lease alive.
8. Existing local delivery remains compatible, and environment lifecycle
   ownership stays within the existing delivery supervisor/client boundaries.
9. Focused real-gRPC evidence starts two identical application nodes and one
   simple delivery server, proves one dispatcher, messages arriving during a
   drain, lease loss, reconnect recovery, overflow recovery, and clean close.
10. Public behavior and configuration documentation remain simple, accurate,
    and explicit about best-effort notification versus durable Inbox recovery.

## High-Risk Assumptions

- Admin shard notifications are wake-up hints, not the durable source of work;
  Inbox storage and the remote lease remain authoritative.
- The Admin snapshot is bounded by the delivery server's configured shard
  count. Reconnect and overflow recovery may replace queued hints with a new
  complete snapshot.
- No ordering guarantee is added across different shards or nodes. One shard
  owner serializes the work selected under that lease.
- This task does not add Stand persistence, EventBus observation, Gateway
  multi-backend fan-out, or dynamic backend discovery.

## Human-Imposed Requirements Ledger

| Requirement | Evidence | Status |
| --- | --- | --- |
| Keep the implementation small and use existing delivery/environment boundaries. | This task and Wave 6 architecture disposition. | Active |
| Treat Admin updates as bounded best-effort wake-up hints; durable Inbox work and remote ownership remain authoritative. | Acceptance criteria 3, 5, and 6. | Active |
| Never add cross-shard ordering or a new serialized/public contract for this correction. | High-risk assumptions and review architecture disposition. | Active |
| Fence stale ownership before framework-owned Entity transaction commit. | Review finding P1 and architecture disposition. | Active |
| Push every RED, GREEN, and correction checkpoint with durable work-log evidence. | BUILD_PROTOCOL and implementation assignment. | Active |

## Implementation Assignment

The existing `implementer` owns production code, focused tests, and affected
documentation. Expected dispatch is explicit `gpt-5.6-terra` / `medium`. The
owner must work RED-first, must not spawn subagents, must preserve unrelated
work, and must push every commit to `origin` immediately. Runtime
self-introspection is unavailable on this surface; acceptance uses the
immutable configured role/profile plus explicit dispatch fields and rejects a
visible mismatch.

## Review Dispositions

- Style/maintainability: required for lifecycle and supervisor boundaries.
- Documentation: required for multi-node configuration and recovery behavior.
- TypeScript/API docs: required if any public configuration or lifecycle API
  changes; otherwise record N/A with exact evidence.
- Performance/reliability: required at Terra/high for concurrency, leases,
  reconnect, bounded queues, and shutdown.
- Security: N/A unless implementation changes a trust boundary or accepts new
  untrusted configuration.

## Verification

Run focused delivery-client, delivery-server, server-environment, and real
two-process gRPC checks before review. After one converged relevant review wave,
run `verify:release` once because distributed runtime behavior changes.
