# T-0226 Work Log

Branch: `feature/async-handlers-querying-black-box`

## Final P2 correction

- `2026-09-09 15:33 WEST`: The final correction was assigned to the existing
  `implementer` role with explicit `gpt-5.6-terra` / medium reasoning. The
  Desktop surface does not expose live model self-inspection; this explicit
  dispatched profile is the available runtime metadata.
- `2026-09-09 15:34 WEST`: RED: three new Process Manager handler-path tests
  initially resolved because the test fixture did not route the supplied
  predicate graph. The expected failures confirmed the test exercised the
  intended handler path rather than a direct core-builder call.
- `2026-09-09 15:34 WEST`: GREEN: the test fixture now supplies a cyclic,
  66-level, or 10,001-node graph through `ProcessManager.select().where()`.
  Each handler captures the expected compiler error before `read()` and each
  test observes zero `QueryReader` calls. No production runtime behavior
  changed.
- `2026-09-09 15:38 WEST`: TypeDoc now generates and audits the exact
  `core/codegen` and `client-node/codegen` inventories. The compatibility
  subpath declares `GeneratedEntityColumns` as a typed identity value so
  TypeDoc includes the retained runtime export.
- `2026-09-09 15:41 WEST`: The server reference now has a standalone strict
  TypeScript snippet showing typed `select`, `where`, `orderBy`, `limit`,
  `read`, `findById`, and `all`. It repeats the 1,000-state ceiling and the
  potential cost of `all()`.

## Evidence

- RED: `pnpm exec vitest run packages/server/test/repository/repository-routing.test.ts --testNamePattern='Process Manager predicate before QueryReader'`
  produced 3 expected failures before the fixture routed supplied graphs.
- GREEN: the same focused command passed 3/3 tests.
- `pnpm exec vitest run packages/server/test/repository/repository-routing.test.ts packages/core/test/query/entity-query.test.ts`
  passed 283/283 tests.
- `pnpm exec tsc -b packages/core packages/server packages/client-node` passed.
- `pnpm typecheck:build:generated` passed.
- `pnpm docs:api:check` passed, including the two three-export codegen
  inventories.
- `node docs/check-typescript-snippets.mjs packages/server/REFERENCE.md` passed.
- `pnpm lint` passed. Focused ESLint, cleanup enforcement, copyright,
  formatting, production-dependency, and `git diff --check` gates passed.

## Known limitations

- Repository-wide `pnpm docs:snippets:check:generated` remains red on unrelated
  unresolved package/example imports. The changed server reference is clean
  when checked directly.
- `2026-09-09 15:49 WEST`: The final correction includes the task-scope
  `ProcessManagerQuery.orderBy` TSDoc repair. It now documents the explicit
  `column` and `direction` parameters rather than stale `args`; `pnpm
lint:tsdoc` passes.

## Next step

The focused API P1 re-review, version-only commit, and release verification are
outside this correction. The branch is ready for the orchestrator to schedule
those remaining task steps after this correction commit and push.
