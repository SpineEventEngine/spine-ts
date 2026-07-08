# T-0015h Generated Registry Closure Review Log

Status: completed
Reviewed basis: baseline `0b6abf9` plus current working tree
Reviewer: implementation sub-agent self-audit

## Review Scope

- Active docs/API docs for stale pre-registry or event-sourced aggregate
  guidance.
- Cleanup enforcement for end-user example guardrail gaps.
- Examples for committed forbidden patterns.
- Focused tests for any guardrail changes.

## Findings

### P1: End-user example cleanup guard did not reject `defineEntityHandlers()`

`scripts/check-cleanup-rules.mjs` rejected framework envelope packing,
schema-bearing decorators, `@Apply`, framework event IDs, manual transactions,
and `materializeDecoratedEntityHandlers()` in example source, but an ordinary
example could still call `defineEntityHandlers()` directly. That would let the
accepted generated-registry workflow regress without committing generated
metadata.

Disposition: fixed. The checker now treats `defineEntityHandlers()` as a
forbidden end-user server API for example source, including direct imports,
aliases, and namespace/property access. Focused test coverage was updated.

### P2: Active docs still contained pre-registry guidance

Current package/API/architecture docs described generated registry schema
inference as future ownership or showed bare decorators paired with manual
explicit metadata in a prominent example.

Disposition: fixed. Docs now describe bare decorators plus generated registry
discovery as the ordinary application workflow, and keep explicit metadata,
schema-bearing decorators, materialization, and envelope packing scoped to
framework tests, generated ingestion, low-level runtime code, or legacy
migration seams.

## Verification

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` passed:
  1 file, 86 tests.
- `corepack pnpm typecheck:build` passed.
- `corepack pnpm docs:check` passed. TypeDoc emitted the existing local warning
  that git remote `origin` is invalid for source links.
- `corepack pnpm lint` passed, including cleanup enforcement.
- `corepack pnpm format:check` passed.
- `git diff --check` passed.
