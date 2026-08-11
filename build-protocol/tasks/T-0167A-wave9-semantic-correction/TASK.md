# T-0167A: Remove TypeScript Semantic Routing

Status: Integrated; post-main proof pending

## Objective

Correct Wave 9 by removing Spine TS interpretation of the Java-specific
`(is).java_type` and `(every_is).java_type` Proto options, together with the
interface-based routing APIs built on those values. Preserve exact-schema
routing, replacement defaults, durable stored-target replay, and the frozen
canonical Proto declarations.

## Classification

High-risk public-contract correction. This removes public TypeScript APIs and
shared runtime metadata across core, transport, and server packages. There are
no external framework users yet, so no compatibility facade or deprecation
period is required.

## Baseline and isolation

- Baseline: `origin/main@42b85501`.
- Branch: `task/T-0167A-wave9-semantic-correction`.
- Worktree: `.worktrees/T-0167A-wave9-semantic-correction`.
- Preserve the dirty primary checkout and all human-owned files.
- Push only to `origin`; do not push upstream or publish packages.

## Human-imposed requirements

1. `(is).java_type` and `(every_is).java_type` are Java-specific metadata and
   must not drive TypeScript behavior.
2. Spine TS must wait for a freshly published and frozen Proto contract with a
   TypeScript-specific type value before supporting interface semantics.
3. Remove interface-based Command, Event, and state-update routing.
4. Remove `routeSemantic()`; it was not approved.
5. Keep exact `.route(schema, callback)` and `.replaceDefault()` routing.
6. Do not implement `@Route` in this correction.
7. Keep the canonical `is` and `every_is` Proto declarations and generated
   exports unchanged; they remain part of the shared Spine Proto vocabulary.
8. Run a one-time repository audit for residual TypeScript interpretation.
   Do not add a permanent checker, manifest, or routine test-run scan.
9. Product Markdown remains Wave 10 work. Correct affected public TSDoc and
   canonical build-protocol records only. `packages/transport/REFERENCE.md` is
   the narrow exception: it directly documented the removed public topic field.

## Acceptance criteria

1. `CommandRouting`, `EventRouting`, and `StateUpdateRouting` expose only exact
   schema routes and replacement-default behavior; `routeSemantic()` is gone.
2. Core type metadata and registry lookup no longer expose or index
   descriptor-derived `isTypes`, `everyIsTypes`, semantic tags, or semantic
   lookup APIs.
3. Server entity/handler/repository routing no longer parses or transports
   `(is)/(every_is)` values.
4. Transport topics no longer carry semantic tags or use them in routing keys.
5. Exact routes, replacement defaults, Event/state zero-target routes, typed
   target persistence, and no-reroute durable replay remain covered.
6. Frozen Proto checks prove the canonical `is`/`every_is` definitions and
   generated artifacts remain unchanged.
7. A recorded one-time repository scan finds no active TypeScript semantic
   routing implementation outside canonical Proto definitions, generated
   representations, historical records, and explicit correction evidence.
8. Required API, build, test, coverage, review, release, integration, and
   post-merge gates pass; `origin/main` contains the correction.

## Assignment and review profiles

- Implementation owner: existing `implementer` role,
  `gpt-5.6-terra` / medium, explicitly dispatched; bounded ownership is the
  T-0167A worktree and correction paths. The owner must not spawn subagents.
- Mechanical verification: orchestrator-dispatched function using the current
  main context; this is not a new role.
- Relevant specialist review after convergence: TypeScript/API and
  style/maintainability use `gpt-5.6-terra` / high; performance/reliability uses
  `gpt-5.6-terra` / high; documentation/TSDoc uses `gpt-5.6-luna` / medium.
- Security is N/A unless the correction changes a trust boundary or secret
  handling; removing semantic metadata does neither.
