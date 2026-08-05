# T-0115: Atomic System Context And Stand Cutover

Status: Complete

## Objective

Builds one internal System Context for each domain Bounded Context, routes
`EntityStateChanged` exclusively through its System EventBus, and gives the
pair one durable subscription runtime and one terminal close operation.

## Classification

High-risk. This task changes context assembly, persistence namespaces, event
routing, subscription reconciliation, public builder API, partial-build
cleanup, and terminal shutdown across shared server runtime code.

## Baseline And Isolation

- Baseline: `origin/main@8059a0a6`.
- Branch: `task/T-0115-system-context-cutover`.
- Worktree: `.worktrees/T-0115-system-context-cutover`.
- The dirty primary checkout remains coordination-only and untouched.

## Human-Imposed Requirements Ledger

1. Every domain Bounded Context has one internal paired System Context.
2. System events never register with, traverse, or touch the domain EventBus or
   domain EventStore.
3. Domain and system contexts have distinct EventBuses, Stands, and storage
   contexts while preserving tenant mode.
4. Raw System Contexts remain internal and absent from application context
   lists, services, and public posting APIs.
5. The pair owns exactly one durable subscription registry, ten-second complete
   snapshot reconciler, timer, attachment map, consumer map, and close.
6. Domain-event targets observe the domain EventBus through domain Stand;
   Entity targets observe the System EventBus through System Stand. Both feed
   one active client stream without duplicates.
7. Preserve the existing domain subscription storage namespace and accepted
   activation, cancellation, restart, deletion, and cleanup semantics.
8. A domain bus rejects every `spine.system.*` schema/post before EventStore
   access; a system bus rejects non-system events. Bus roles are internal.
9. `persistSystemEvents()` is the only new public option. Forgetting is the
   default; opt-in storage is separate and uses the app-selected
   `StorageFactory` under a reserved System Context name.
10. System-post failure after a committed entity update is bounded diagnostic
    failure and never rolls back committed domain work.
11. Partial builds release every acquired resource.
12. Close is one terminal coalesced attempt. It stops domain intake, drains
    domain work while system publication remains available, then drains system
    work, stops reconciliation, detaches observers/consumers, closes both
    Stands, closes the shared registry once, and closes remaining pair-owned
    resources in dependency order.
13. Close attempts every hook, aggregates independent failures, and repeated
    calls return the same promise/outcome without retrying hooks.
14. Injected-failure tests prove no timer, attachment, consumer, Stand,
    EventBus/EventStore, registry, storage, tenant-index, or metadata leak.
15. Do not implement lifecycle/dispatch events owned by T-0116/T-0117,
    Message Board changes owned by T-0118, or broad docs owned by T-0119.
16. Do not build or modify Spine JVM, publish to npm, or push to the future
    migration remote.
17. Push every feature-branch commit immediately to canonical `origin` and
    preserve protected user-owned files.

## Acceptance

The complete T-0115 acceptance contract is the corresponding section of
`build-protocol/planning/T-0113_SYSTEM_CONTEXT_PLAN.md`. Focused tests must
cover context pairing, distinct storage/buses, strict schema-role matrix,
subscription target classification and single reconciliation ownership,
default-forget/opt-in persistence, multitenancy, restart convergence,
partial-build cleanup, terminal close ordering, coalescing, aggregation, and
injected failures.

## Implementation Assignment

- Existing role: implementer.
- Agent task name: `/root/t0115_impl`.
- Scope: T-0115 server runtime, focused tests, public `persistSystemEvents()`
  TSDoc/export evidence, and task records.
- Expected model, explicitly dispatched: `gpt-5.6-terra`.
- Expected reasoning, explicitly dispatched: `medium`.
- Runtime metadata: pending acceptance; immutable configured profile and any
  self-introspection limitation will be recorded.

## Skill Applicability

- Inventory sources were refreshed from the session inventory,
  `build-protocol/skills/EXPECTED_SKILLS.md`, the bounded installed-skill
  listing, and `~/.agents/.skill-lock.json`.
- Selected and already fully read in this session: `using-git-worktrees`,
  `executing-plans`, `subagent-driven-development`, and
  `test-driven-development`. `requesting-code-review` and
  `verification-before-completion` were also fully read before their first
  applicable gates and remain governing.
- Project specialist roles and task/work/review logs supersede the generic
  skill's generic reviewer and `.superpowers` ledger suggestions.
- `architecture-patterns`, `cqrs-implementation`, and `event-store-design`
  remain unselected: T-0113 already froze this architecture and no new storage
  schema or CQRS boundary may be invented here.
- No dependency is selected. Pairing and lifecycle belong to the existing
  server runtime; a new library would add policy without reducing complexity.

## Review Dispositions

- Style/maintainability: relevant to the large shared-runtime refactor.
- Documentation: relevant to the new public builder TSDoc and narrow package
  behavior claims only; broad documentation is deferred to T-0119.
- TypeScript/API docs: relevant to `persistSystemEvents()` and internal/public
  boundaries.
- Performance/reliability: required for persistence, timers, concurrency,
  reconciliation, partial builds, and terminal close.

## Verification Profile

Focused server tests and changed-source coverage precede review. Because shared
runtime, persistence, lifecycle, and public API change, one converged
`verify:release` gate is mandatory after review.
