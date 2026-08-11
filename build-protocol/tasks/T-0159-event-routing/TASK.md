# T-0159: Event Routing

Status: In progress

## Objective

Add the public `EventRoute<Id, Schema>` and `EventRouting<Id>` contracts and
integrate one immutable validated target plan into Process Manager and
Projection admission, handoff, dispatch, and replay.

## Classification

High-risk. This task adds a public generic API and changes multicast Entity
selection, durable Inbox admission, replay, and JVM-compatible producer-ID
fallback behavior.

## Baseline And Isolation

- Baseline: `origin/main@3168135d`.
- Branch: `task/T-0159-event-routing`.
- Worktree: `.worktrees/T-0159-event-routing`.
- Preserve the dirty primary checkout and unrelated worktrees.
- Push only to `origin`; never push the upstream remote.

## Acceptance Criteria

1. Export the frozen `EventRoute<Id, Schema>` and `EventRouting<Id>` API with
   `create()`, exact `route()`, descriptor-backed `routeSemantic()`, and
   `replaceDefault()`; construction is factory-only and repositories snapshot
   declarations.
2. Add typed `eventRouting` to `RepositoryOptions` using the inferred Entity ID
   type.
3. Resolve exact schema > descriptor `(is)` > descriptor `(every_is)` >
   replacement/default; caller compatibility `semanticTags` never participate.
4. Default routing uses a present, readable, ID-compatible producer. A valid
   incompatible producer falls back to the Event's declaration-first field. An
   absent producer or malformed producer claiming the compatible type fails.
5. Remove the old requirement that producer and first Event field identify the
   same Entity. Producer compatibility selects the route; fallback is used only
   for an incompatible producer type.
6. Event routes return zero, one, or many IDs. Validate the raw result before
   handoff, cap it at 1,000, copy it, stable-deduplicate it, freeze it, and
   reject every malformed ID before admitting any target. `[]` intentionally
   suppresses delivery to that repository.
7. Evaluate application routing once for each accepted Event admission. Pass
   the immutable target plan through Process Manager and Projection handoff.
   Durable replay decodes and validates the stored typed target and never calls
   application routing again.
8. Cover Process Manager and Projection execution, exact/semantic/default
   precedence, snapshots, multicast, empty routes, invalid/overflow results,
   the complete producer matrix, and restart/replay with focused RED/GREEN
   tests.
9. Reach at least 90% in every changed-production-source metric and run the
   generated build, tooling, changed TypeScript ESLint, TSDoc/API checks,
   Prettier, `git diff --check`, and prohibited compatibility scans.
10. Complete one style/maintainability, TypeScript/API documentation,
    documentation/TSDoc, and performance/reliability review wave. Security is
    N/A because no trust boundary changes.
11. Run one final `verify:task`, merge to `origin/main`, and delete the merged
    task branch/worktrees.

## Exclusions

- State-update routing, `@Where`, field Stringifiers, implicit-required
  validation, rejection conformance, examples, product Markdown, and copyright
  headers.
- Compatibility aliases or routing from caller `semanticTags`.

## Implementation Assignment

- Existing role: implementer acting as a senior TypeScript routing/runtime
  engineer.
- Ownership: Event routing declarations, `RepositoryOptions` Event members,
  Process Manager/Projection admission/handoff/replay integration, exports,
  focused tests, and T-0159 records.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both dispatch fields are explicit. The implementer must not spawn subagents.

## Review And Verification

- Style/maintainability: required; configured `gpt-5.6-terra` / high.
- TypeScript/API documentation: required; configured `gpt-5.6-terra` / high.
- Documentation/TSDoc: required; configured documentation reviewer
  `gpt-5.6-luna` / medium.
- Performance/reliability: required; configured `gpt-5.6-terra` / high.
- Security: N/A because no authentication, authorization, secret, or external
  trust-boundary behavior changes.
