# T-0183: Interface-Token Repository Routing

Status: Release lint correction complete; final release verification pending
Start: `2026-08-14 03:53 WEST`
End: Pending
Baseline commit: `d02379f7`
Branch: `task/T-0183-interface-routing`
Worktree: `.worktrees/T-0183-interface-routing`
Task classification: High-risk
Implementation owner: existing `implementer`, explicit `gpt-5.6-terra` / medium
Implementation commit: `c74c9310`, `27fa36df`, `11e5d867`, `788a22d0`; correction record checkpoint pending
Release lint correction checkpoint: `b6ca9ab7`

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

The shared declaration snapshot now resolves exact schema routes before ordered
nominal interface-token routes before replacement/default routes. Command,
Event, and state-update declarations overload the existing `.route(...)` API
for `MessageInterface`; construction validates all token members against the
registered schemas. Focused tests cover copied-token rejection, duplicate and
incomplete declarations, selection precedence, callback typing, and one
admission/no-recomputation replay path for each signal kind. Full coverage is
95.25% lines, 90.44% branches, and 94.07% functions. The complete
`verify:task -- --no-coverage` gate passed with the five focused routing test
files after that coverage evidence. Specialist review, release verification,
integration, tag, and post-merge verification remain pending.

## Review Correction Result

The accepted API, style, and TSDoc findings are resolved at `788a22d0`: the
public API inventory includes `InterfaceRouteMessage`; the immutable map facade
does not expose its backing map; token classification and schema-tuple typing
live only in the shared declaration seam; and each public route declaration
documents its schema/token callback, precedence, validation, and durable replay
behavior. Public compile-time regressions cover a two-member interface token
for Command, Event, and state-update routing. The correction passes 262 focused
tests, full 95.25% line / 90.44% branch / 94.11% function coverage, and the
complete `verify:task` preflight. Targeted re-review, release verification,
integration, tag, and post-merge verification remain pending.

## Targeted API/TSDoc Correction

The confirming TypeScript/API (`gpt-5.6-terra` / high) and documentation/TSDoc
(`gpt-5.6-luna` / medium) review lanes identified an unbound TypeDoc parameter
warning. All Command, Event, and state-update `.route(...)` overloads now use
the shared `schemaOrToken` parameter name named by their TSDoc. TypeDoc and API
checks, tooling typecheck, 262 focused routing tests, formatting, and diff
checks pass. Release verification, integration, tag, and post-merge
verification remain pending.

## Release Lint Correction

The first post-review `verify:release` attempt stopped at its full-repository
ESLint stage, before executing tests. It reported 17 mechanical findings in
the T-0183 routing source and tests: redundant schema assertions, a mutable
facade declaration and confusing void-expression callbacks, and test-style
violations. This correction removes only those lint violations; routing
selection, admission, replay, and persisted Inbox targets are unchanged.

Checkpoint `b6ca9ab7` contains the correction and durable records. The complete
repository ESLint run, the five focused routing suites (262/262
tests), tooling typecheck, TypeDoc/API checks, format check, and diff check
pass after the correction. The branch is ready for the orchestrator's final
release attempt; this implementation context did not rerun `verify:release`.

## Second Release Cleanup Correction

The second `verify:release` attempt cleared full-repository ESLint and then
stopped at cleanup, before tests, because `readOnlyMap()#1` had no exact
standalone-function necessity disposition. The canonical T-0080F ledger now
records its TypeScript immutable-collection boundary: it creates the frozen
map facade required to preserve `forEach` callback identity without exposing
mutable declaration storage. No routing behavior or API changed.

`pnpm lint:cleanup`, full ESLint, and the five focused routing suites (262/262)
pass after the ledger correction. This context did not rerun `verify:release`;
the branch is ready for the orchestrator's next release-profile attempt.

## Third Release TSDoc Correction

The third `verify:release` attempt cleared ESLint and cleanup, then stopped at
TSDoc before tests. The route overload declarations lacked their own summaries,
parameters, and return documentation, and shared routing declaration types and
properties lacked summaries. The correction adds concise declaration-level
documentation while preserving the established implementation-level precedence,
validation, and replay explanation. No routing behavior, API shape, persistence,
or replay semantics changed.

TSDoc enforcement, API documentation generation/checking, full ESLint, cleanup,
and the five focused routing suites (262/262) pass after the correction. This
context did not rerun `verify:release`; the branch is ready for the
orchestrator's next release-profile attempt.

## Fourth Release TSDoc Layout Correction

The fourth `verify:release` attempt again reached TSDoc after cleanup and
reported only two missing blank lines before the first property documentation
blocks in the shared mutable and snapshot routing declarations. Prettier had
removed ordinary blank lines after the interface openings. The established
`// prettier-ignore` preservation convention now protects each required blank
line, with no runtime or API change.

After formatting the source, format check and TSDoc enforcement both pass;
rerunning the formatter preserves the required layout. Full ESLint, cleanup,
the five focused routing suites (262/262), and diff integrity also pass. This
context did not rerun `verify:release`; the branch is ready for the
orchestrator's next release-profile attempt.
