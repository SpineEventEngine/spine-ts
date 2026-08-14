# T-0183: Interface-Token Repository Routing

Status: Implementation authorized; assignment pending
Start: `2026-08-14 03:53 WEST`
End: Pending
Baseline commit: `d02379f7`
Branch: `task/T-0183-interface-routing`
Worktree: `.worktrees/T-0183-interface-routing`
Task classification: High-risk
Implementation owner: existing `implementer`, explicit `gpt-5.6-terra` / medium
Implementation commit: Pending
Final branch HEAD: Pending

## Objective

Extend Command, Event, and state-update routing so the existing `.route(...)`
method accepts T-0181 `MessageInterface` tokens. Preserve exact-schema and
replacement/default routes, apply exact then first registered matching token
then default precedence, and preserve durable replay without adding serialized
route metadata.

## Required Inputs

- `AGENTS.md`, `build-protocol/BUILD_PROTOCOL.md`, and
  `build-protocol/PROJECT_COMPLETION_PLAN.md`.
- `build-protocol/planning/WAVE_11_TS_TYPE_ROUTING_PLAN.md`, D-0113, and the
  completed T-0181/T-0182 records and public contracts.

## Human-Imposed Requirements Ledger

1. Overload the existing `.route(...)` API for `MessageInterface`; do not add
   `routeSemantic()`, `@Route`, semantic strings, or interface-name lookup.
2. Support Command, Event, and state-update declarations with the frozen
   `InterfaceRouteMessage<TInterface, Schemas>` callback type:
   `MessageShape<Schemas[number]> & TInterface`.
3. Resolve exact schema first, then the first matching valid interface token in
   explicit registration order, then replacement/default. Do not infer
   specificity or reorder declarations.
4. Exact and token duplicates, malformed/copied tokens, incomplete membership,
   invalid callbacks/results/targets, and over-1,000 multicast results fail
   closed before handoff. Command remains unicast; Event/state remain
   zero-to-many with copied, stable-deduplicated, frozen targets.
5. Application routing runs once per accepted admission and zero times on
   durable replay. Persist only the existing typed Inbox targets; change no
   Inbox/provider/wire format.
6. Cover registration order, parent/child membership, exact precedence
   independent of call order, invalid tokens, cardinalities, target validation,
   all three admission/replay paths, and a pre-Wave-11 Inbox replay fixture.
7. Do not change To-Do, reader documentation, multiple-Gateway behavior,
   generated interface contracts, or authored-interface discovery.

## Scope

In scope: the three repository routing declaration modules, one internal shared
declaration/snapshot/selection module, repository construction and selection,
server root exports only if required, and focused routing/admission/replay tests.

Out of scope: T-0184 To-Do proof, T-0185 beginner docs, T-0186 convergence,
new persistence, semantic tags, and Gateway work.

## Review And Verification Plan

- Relevant specialist lanes: TypeScript/API, style/maintainability,
  performance/reliability, and documentation/TSDoc.
- Security is N/A for this task: no dependency, secret, IPC, tenant,
  deserialization, or external capability boundary changes; T-0186 owns final
  Wave security review.
- Focused RED/GREEN, changed-source branch coverage at or above 90%, cheap
  preflight, one specialist review wave and correction batch, then one
  `verify:release` after convergence.

## Integration Result

Pending implementation, review, release verification, integration, tag, and
post-merge verification.
