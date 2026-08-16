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
- Counterfeit marker proof: a resolved path mapping to a different
  `counterfeit/handler/external.ts` is not classified as external; the origin
  suite now has 5 passing assertions.

## Final state-origin proof

- Seven owned handler, registry, EventBus, repository, and BoundedContext test
  files passed 424 assertions after the final corrections.
- The complete repository-routing suite passed 245 assertions, including a new
  module-interface case proving that domestic and external
  `EntityStateChanged` events select only their matching state receptors during
  normal System EventBus delivery and durable inbox replay.
- `pnpm typecheck:build:generated`, focused ESLint, Prettier, owned TSDoc, and
  `git diff --check` passed. Copyright checking reports only the two inherited
  Wave 13 RED fixtures owned by later broker/ThirdParty work; all T-0197b-owned
  headers pass.
- Final performance/reliability re-review passed with 250 focused assertions.
  Final TypeScript/API re-review passed 313 focused assertions after correcting
  its sole P2: the writer documentation now names the emitted registry v3.
