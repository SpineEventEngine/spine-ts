# T-0197b evidence

- Baseline: `aaff3b4c`.
- `git diff --check`: passed.
- Prettier: passed on every changed TypeScript file.
- Focused Vitest invocation reached the test loader but could not resolve the
  stale isolated-worktree package graph (`@spine-event-engine/validation-ts`).
- Static TypeScript invocation likewise reports the pre-existing stale workspace
  package graph; after filtering diagnostics, no error pointed at the modified
  handler-origin or bus-filtering code.

## Correction evidence

- `pnpm install --offline --frozen-lockfile`: passed.
- `pnpm proto:generate`: passed; only regenerated volatile generation IDs, which
  were restored because no serialized contract changed.
- `pnpm typecheck:build:generated`: passed.
- Handler/origin focused suites: 67 passed.
- EventBus, state-update routing, repository routing, and bounded-context suites:
  359 passed.

- Final owned matrix after symmetric state filtering: generated typecheck passed;
  eight focused suites passed 426 tests. The analyzer cycle guard and exact
  declaration-directory identity regression then passed in the origin suite.
