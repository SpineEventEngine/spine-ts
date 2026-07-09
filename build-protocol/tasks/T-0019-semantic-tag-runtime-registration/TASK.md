# T-0019: Semantic Tag Runtime Registration

Status: planned on `main`; pending task branch
Started: `2026-07-09`
Branch: `task/T-0019-semantic-tag-runtime-registration`
Worktree:
`.worktrees/T-0019-semantic-tag-runtime-registration`
Base commit: `21d554f`

## Objective

Close the remaining T-0018e runtime gap by making server runtime routing consume
descriptor-derived semantic tags that are already extracted from `(is)` and
`(every_is)` metadata. Keep the slice narrow: route planning should pass those
tags to transport topics without adding new handler materialization,
transactions, delivery behavior, or application-owned registration APIs.

## Scope

- Update runtime routing in `packages/server/src/runtime/runtime-routing.ts`.
- Add focused tests in `packages/server/test/runtime/runtime-routing.test.ts`.
- Update public docs that currently say runtime handler/readiness/routing
  registries do not consume semantic tags.
- Update durable T-0019 work and review logs.
- Do not edit generated files.
- Do not add new proto files unless implementation discovers a real blocker in
  existing fixtures.

## Acceptance Criteria

- Command runtime topics include semantic tags from the command assignee
  entity metadata.
- Event runtime topics include a deterministic, deduplicated union of semantic
  tags from all registered receivers for that event type.
- Transport routing keys and subscriptions reflect those semantic tags through
  the existing transport topic contract.
- Runtime routing outputs remain frozen and copy-safe.
- Existing validation/security behavior for authentic readiness, forged
  readiness, malformed metadata, and deferred query/subscription/system seams is
  unchanged.
- Public docs no longer claim that runtime handler/readiness/routing registries
  ignore semantic tags once this task is merged.
- No generated files are committed.

## Verification Plan

- Targeted Vitest for runtime routing:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/runtime/runtime-routing.test.ts --passWithNoTests`.
- Targeted transport contract check if routing-key expectations change:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/transport/test/index.test.ts --passWithNoTests`.
- `pnpm --config.verify-deps-before-run=false typecheck:build`.
- `pnpm --config.verify-deps-before-run=false docs:check`.
- `pnpm --config.verify-deps-before-run=false format:check`.
- `git diff --check`.

## Requirements Splitter Result

- Splitter: `019f4849-2476-7fc0-bad6-64850236e82f`; completed and closed by
  root.
- First non-blocked slice: plumb existing descriptor-derived semantic tags into
  `createServerRuntimeRoutingPlan`.
- Recommended design: command topics use the assignee entity tags; event topics
  use the deterministic union of all receiver entity tags.
- No blocking questions reported.
