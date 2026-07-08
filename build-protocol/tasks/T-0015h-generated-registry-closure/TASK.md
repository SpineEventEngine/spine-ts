# T-0015h: Generated Registry Closure Audit

Status: completed
Start: `2026-07-08 01:05 WEST`
End: `2026-07-08 01:08 WEST`
Baseline commit: `0b6abf9`
Initial implementation commit: `63cf783`
Final closure commit: `72d68fc`
Integrated to main: `1dff3e0`
Branch: `task/T-0015h-generated-registry-closure`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0015h-generated-registry-closure`

## Objective

Close the T-0015 generated-registry series by auditing current docs, API docs,
cleanup enforcement, examples, and tests for stale pre-registry or
event-sourced aggregate guidance.

## Binding Requirements

- Ordinary end-user app workflow is bare decorators plus generated registry
  metadata.
- End-user code must not materialize decorated handlers, call
  `defineEntityHandlers()` for ordinary decorated handlers, or use
  schema-bearing decorators.
- Ordinary handlers return generated domain messages, not framework
  `Event`/`Command` envelopes.
- Ordinary aggregate code must not use `@Apply`, create framework event IDs, or
  manage framework transactions directly.
- Generated output under `generated/` is ignored, regenerated, and uncommitted.
- Docs and APIs stay small and JVM-familiar. Avoid broad new concepts or
  speculative facades.

## Scope

- Audit active documentation and examples for stale pre-generated-registry
  instructions.
- Inspect cleanup enforcement for stale allowlists or guardrail gaps.
- Fix only focused stale guidance or small regression-prone guardrail issues.
- Update durable task, review, and work logs.

## Findings And Fixes

- Active example source scan found no committed example use of
  `defineEntityHandlers()`, `materializeDecoratedEntityHandlers()`, `@Apply`,
  `packEvent()`, `EventIdSchema`, or app-owned transaction calls.
- Cleanup enforcement already rejected schema-bearing decorators, framework
  envelopes, event IDs, manual materialization, `@Apply`, and app-owned
  transaction calls in end-user example source.
- Cleanup enforcement did not reject direct `defineEntityHandlers()` use in
  end-user example source. Added that guard and focused coverage for direct and
  namespace imports.
- Current docs still had stale wording that described generated registry schema
  inference as future ownership or paired bare decorators with manual explicit
  metadata. Updated those docs to make generated registry discovery the
  ordinary application bridge while keeping explicit metadata as a low-level
  framework/test/migration seam.

## Verification

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` passed:
  1 file, 92 tests.
- `corepack pnpm typecheck:build` passed.
- `corepack pnpm docs:check` passed. TypeDoc emitted the existing local
  warning that git remote `origin` is invalid for source links.
- `corepack pnpm lint` passed, including cleanup enforcement.
- `corepack pnpm format:check` passed.
- `git diff --check` passed.
- Post-merge focused cleanup-rule tests on `main` passed: 1 file, 92 tests.
- Post-merge `corepack pnpm docs:check` and `corepack pnpm lint` passed on
  `main`.
