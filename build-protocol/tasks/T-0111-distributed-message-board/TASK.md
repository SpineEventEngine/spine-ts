# T-0111: Distributed Message Board And Example Migration

Status: In Progress

## Objective

Adds a Distributed Message Board example that reuses the existing Message Board
domain model and React UI while demonstrating two identical application nodes,
one standalone Gateway, shared application-selected storage, and the in-memory
simple delivery server. Updates every example to use the corrected distributed
delivery defaults.

## Classification

High-risk. The task validates the integrated delivery, Stand, Gateway, storage,
startup, shutdown, and example contracts across real processes.

## Baseline And Isolation

- Baseline: `origin/main@52525170`.
- Branch: `task/T-0111-distributed-message-board`.
- Worktree: `.worktrees/T-0111-distributed-message-board`.
- The dirty primary checkout is coordination-only and remains untouched.

## Acceptance Criteria

1. `examples/distributed-message-board/` reuses the Message Board model and UI
   rather than copying domain or React implementation.
2. Its documented topology contains two identical application nodes, one
   standalone Gateway, one in-memory simple delivery server, and shared
   application-selected storage.
3. A command may enter through either configured node, but one Aggregate handles
   it and the Projection state is written once.
4. A browser connected through the one Gateway re-queries and observes the
   authoritative Projection state; subscription notices remain best effort.
5. Startup and shutdown are deterministic, finite, and each documented process
   starts with one pnpm command.
6. Every existing example uses the corrected delivery defaults and remains
   independently startable according to its README.
7. No JVM build/source change, npm publication, Redis, Hazelcast, durable
   delivery server, or Wave 7 discovery/redeployment behavior is introduced.
8. Focused distributed acceptance, example startup commands, browser tests,
   canonical review concerns, and `verify:release` pass before merge.

## Verification Profile

- RED-first distributed behavior tests and focused example checks.
- Mandatory cheap preflight before specialist review.
- Style, documentation, TypeScript/API, and reliability review; security is N/A
  unless implementation exposes a new trust boundary.
- Final `verify:release`, merge, post-merge verification, and remote cleanup.
