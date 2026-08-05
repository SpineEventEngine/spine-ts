# T-0117: Dispatch Diagnostic System Events

Status: Baseline and focused implementation pending

## Objective

Emits the supported System diagnostics only after a command or event is
accepted for dispatch to its handler.

## Classification

High-risk. This task changes serialized System-event production at handler
admission boundaries across commands, subscribers, and reactors, including
multitenancy and post-dispatch failure isolation.

## Baseline And Isolation

- Baseline: `origin/main@eca8f7fe`.
- Branch: `task/T-0117-dispatch-diagnostics`.
- Worktree: `.worktrees/T-0117-dispatch-diagnostics`.
- The dirty primary checkout remains coordination-only and untouched.

## Acceptance Ledger

1. Accepted command-handler dispatch emits `CommandDispatchedToHandler`.
2. Accepted Projection subscriber dispatch emits
   `EventDispatchedToSubscriber`.
3. Accepted Aggregate and Process Manager reactor dispatch emits
   `EventDispatchedToReactor`, including Process Manager `@Assign` command and
   reactor paths.
4. Receiver, original payload, Entity type, dispatch timestamp, origin, and
   tenant context follow the frozen Proto contracts.
5. Routing/refusal, missing target, absent handler, rejected admission, or any
   failure before handler invocation emits no diagnostic.
6. Handler failure after admission does not erase the diagnostic; diagnostic
   publication failure does not retry, repeat, or roll back handler work.
7. Diagnostics register with and post only through the paired System EventBus;
   none touches the domain EventBus or domain EventStore.
8. Single-tenant and multitenant tests prove exact tenant propagation and
   isolation.
9. Existing handler return, transaction, delivery, and rejection semantics do
   not change.
10. T-0118 Message Board synchronization and T-0119 broad documentation remain
    out of scope.

## Implementation Assignment

- Existing role: implementer `/root/t0117_impl`.
- Ownership: exact frozen-schema map, post-admission production seams, focused
  RED/GREEN tests, and task records.
- Expected and explicitly dispatched model: `gpt-5.6-terra`.
- Expected and explicitly dispatched reasoning: `medium`.
- Runtime metadata: pending; immutable configured role/profile and any
  self-introspection limitation must be recorded before acceptance.
- The owner may not spawn subagents.

## Review Dispositions

- Style/maintainability: relevant to shared handler execution paths.
- Documentation: N/A unless public prose or claims change; record a concrete
  final disposition.
- TypeScript/API docs: relevant to frozen serialized diagnostic contracts.
- Performance/reliability: required for admission ordering, failure isolation,
  multitenancy, and no-repeat behavior.
- Security: N/A unless implementation introduces a new untrusted-input or data
  exposure surface.

## Verification Profile

Focused handler-family/routing/System-bus tests and changed-line coverage
precede review. Shared runtime and serialized behavior require one converged
`verify:release` gate.
