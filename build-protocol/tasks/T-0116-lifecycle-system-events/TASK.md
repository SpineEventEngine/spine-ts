# T-0116: Entity Lifecycle System Events

Status: Complete; merged, post-merge verified, and pushed

## Objective

Emits creation, state-change, archive, unarchive, delete, and restore System
events only after their corresponding Entity transition commits durably.

## Classification

High-risk. This task changes serialized System-event production, repository
commit semantics, lifecycle transition detection, ordering, multitenancy, and
subscription removal/restoration across every Entity family.

## Baseline And Isolation

- Baseline: `origin/main@6523a68c`.
- Branch: `task/T-0116-lifecycle-system-events`.
- Worktree: `.worktrees/T-0116-lifecycle-system-events`.
- The dirty primary checkout remains coordination-only and untouched.

## Acceptance Ledger

1. Emits `EntityCreated`, `EntityStateChanged`, `EntityArchived`,
   `EntityUnarchived`, `EntityDeleted`, and `EntityRestored` only after a
   durable committed transition.
2. Populates correct Entity ID, signal IDs, old/new state where defined,
   version, timestamp, tenant context, and Entity kind according to the frozen
   Proto contracts.
3. Preserves deterministic per-commit System-event ordering.
4. Emits nothing for rejected, rolled-back, or lifecycle no-op operations.
5. Covers Aggregate, Process Manager, and Projection repositories, including
   single-tenant and multitenant contexts.
6. Entity subscriptions remove archived, deleted, and no-longer-matching rows,
   and deliver restored or unarchived rows through the existing wire protocol.
7. Every lifecycle event uses only the paired System EventBus; none registers
   with, traverses, or touches the domain EventBus/EventStore.
8. System-event publication failure remains post-commit diagnostic failure and
   cannot roll back committed domain work.
9. T-0117 dispatch diagnostics, T-0118 Message Board, and T-0119 broad docs are
   out of scope.
10. No Spine JVM build/source modification, npm publication, or future-remote
    push occurs.

## Architecture Assignment

- Existing role: requirements splitter `/root/t0116_split`.
- Ownership: read-only schema/seam/ordering/RED-test implementation map for the
  frozen T-0116 acceptance contract.
- Expected and explicitly dispatched model: `gpt-5.6-sol`.
- Expected and explicitly dispatched reasoning: `high`.
- Runtime metadata: pending; immutable role/profile and any introspection
  limitation will be recorded before acceptance.

## Implementation Assignment

- Existing role: implementer `/root/t0116_impl`.
- Ownership: repository lifecycle System-event production, System Stand
  subscription rendering, focused RED/GREEN tests, and task records.
- Expected and explicitly dispatched model: `gpt-5.6-terra`.
- Expected and explicitly dispatched reasoning: `medium`.
- Runtime metadata: pending; immutable role/profile and any introspection
  limitation will be recorded before acceptance.

## Review Dispositions

- Style/maintainability: relevant to shared repository transition code.
- Documentation: relevant only if changed public TSDoc/claims require it;
  otherwise a concrete N/A disposition is required.
- TypeScript/API docs: relevant to serialized Proto use and any public/internal
  seam changes.
- Performance/reliability: required for ordering, commit boundaries,
  multitenancy, failure isolation, and subscription behavior.

## Verification Profile

Focused repository/lifecycle/subscription tests and changed-code coverage
precede review. Shared runtime and serialized behavior require one converged
`verify:release` gate.
