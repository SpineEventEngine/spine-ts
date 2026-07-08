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

## Review-Fix Follow-Up

Status: completed

- Applied the complete T-0015h review-fix list:
  generated-registry README security/API sample fixes, stale import cleanup,
  focused cleanup-rule assertions for `defineEntityHandlers()`, current
  `allowImport`/transaction/family documentation wording, and durable log
  updates.

### Verification

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` passed:
  1 file, 92 tests.
- `corepack pnpm docs:check` passed. TypeDoc emitted the existing local warning
  that git remote `origin` is invalid for source links.
- `corepack pnpm lint` passed, including cleanup enforcement.
- `corepack pnpm typecheck:build` passed.
- `corepack pnpm format:check` passed.
- `git diff --check` passed.

## Second Review-Fix Follow-Up

Status: completed

- P2 handler-decorator public JSDoc stale wording: fixed. Public comments now
  describe schema-bearing decorator overloads as present compatibility forms,
  subscriber decorator metadata as a current generated-registry/runtime bridge,
  and generated framework registries as current owners of bare-decorator schema
  inference.
- P2/P1 entity/runtime future-only wording: fixed. Public docs and API comments
  now describe protected entity hooks, entity-family bases, and
  `EntityTransaction` as current low-level framework seams used by repository
  and runtime code.
- P1 aggregate replay/snapshot stale docs: fixed. Active docs now describe
  generated-registry aggregate loading from latest persisted state, event
  storage as a traceability journal, no ordinary snapshot-plus-replay loading
  path, and low-level aggregate-history APIs as legacy/internal compatibility
  support.

### Verification

- `corepack pnpm docs:check` passed. TypeDoc emitted the existing local warning
  that git remote `origin` is invalid for source links.
- `corepack pnpm format:check` passed.
- `git diff --check` passed.
- `corepack pnpm typecheck:build` passed.
