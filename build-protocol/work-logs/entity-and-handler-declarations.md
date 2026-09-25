# Entity and handler declarations: work log

Task: entity-and-handler-declarations.
Branch and checkout: `entity-and-signal-handler-declarations`, existing checkout.
Start: 25 September 2026. Status: implementation in progress.

Requirements and acceptance are in
[the plan](../planning/entity-and-handler-declarations.md), including its complete
Human-Imposed Requirements Ledger. No unresolved human questions.

## Assignments

- Implementation: existing implementer, explicitly `gpt-6-sol` / `medium`.
  Scope: version correction, then handler return support, related tests and docs.
  The implementation report records files and focused test evidence here.
- Main agent: task records, review coordination, release version and CI checks.

## Progress

- Official origin fetched; master remains `2b27a430d`. Existing branch preserved.
- Planning and JVM source comparison complete; no architecture replanning needed.
- Implementation dispatched after recording requirements and skill selection.
- Version slice implemented: Entity families now expose the generated Spine
  `Version` with a zero default and defensive snapshot copying. A successful
  state/lifecycle change or produced Events advances it once per dispatch;
  pure no-ops, including a fresh incomplete state, skip validation and storage.
  Repository current/history/Stand records share the committed Version;
  Projection and Process Manager versions no longer copy producer versions.
- Focused regressions cover state-only and Event-only changes, multiple input
  Events, same-timestamp Version parity, unchanged reactions, and no-op new
  Entities. Legacy third generic arguments and custom metadata helpers were
  removed from package sources, examples, and affected test declarations.

## Verification

- `pnpm exec vitest run packages/server/test/entity/entity.test.ts packages/server/test/entity/entity-transaction.test.ts packages/server/test/repository/repository-routing.test.ts packages/server/test/repository/repository.test.ts --maxWorkers=1`: 4 files, 340 tests passed.
- `pnpm exec tsc --noEmit --pretty false -p packages/server/tsconfig.json`:
  passed. `pnpm exec tsc --noEmit --pretty false -p tsconfig.eslint.json`: passed.
- `pnpm lint:cleanup`: passed. Version work used failing focused regressions
  before the relevant runtime changes. The broad TSDoc checker found baseline
  missing declarations in affected files; narrow comment correction is being
  coordinated while production behavior stabilizes, without weakening rules.
- Full release verification follows three completed review-and-fix rounds.

## Integration

Version checkpoint pending. Handler returns follow sequentially. No PR creation
authorized.
