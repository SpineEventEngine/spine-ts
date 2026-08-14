# T-0183 Review Log

Status: Release lint correction complete; final release verification pending

Task: `build-protocol/tasks/T-0183-interface-token-routing/TASK.md`
Branch: `task/T-0183-interface-routing`
Baseline: `d02379f7`

## Planned Dispositions

- TypeScript/API: public overload inference, generic callback contracts, and
  compatibility of exact routes.
- Style/maintainability: one shared deep internal declaration/snapshot module
  without three competing implementations.
- Performance/reliability: bounded result validation, deterministic precedence,
  admission/replay lifecycle, snapshot cleanup, and no persistence drift.
- Documentation/TSDoc: public overload/precedence/replay claims and truthful
  task evidence; reader documentation remains T-0185.
- Security: N/A for this bounded internal dispatch extension; T-0186 owns final
  Wave security.

## Assignment Evidence

The implementation assignment uses the existing `implementer` role with
explicit `gpt-5.6-terra` / medium. Reviewer profiles will be recorded at
dispatch. Runtime metadata is recorded when exposed; otherwise the immutable
configured role/profile and telemetry limitation are evidence.

## Findings And Outcome

Focused RED/GREEN evidence is complete. The shared routing declaration seam
proves exact > registration-ordered token > default selection, rejects copied
tokens and incomplete membership, and snapshots declarations. Repository tests
prove construction-time membership validation and Command/Event/state selection;
admission/replay tests prove one callback on admission and none on stored-row
replay for each signal kind. Specialist review remains pending.

## Pre-Review Mechanical Evidence

- `pnpm exec vitest run --coverage` completed for the full project: 19,529 /
  20,503 lines (95.25%), 12,245 / 13,539 branches (90.44%), and 5,110 / 5,432
  functions (94.07%). This is the needed global coverage evidence for the
  shared `repository.ts` runtime file; the isolated include-only subset loads
  that large module but cannot represent its established unrelated branches.
- `git diff --check origin/main...HEAD` passed.
- `pnpm verify:task -- --no-coverage` passed with the five focused routing
  test files after the full coverage run. It completed the non-Markdown task
  gates: Proto generation/lint/currentness, build and tooling typechecks,
  ESLint, cleanup/TSDoc/copyright/format checks, logging containment,
  documentation audience/API checks, and release readiness.
- Next: dispatch the relevant API, style, reliability, and documentation review
  lanes; security remains N/A until T-0186 as planned.

## Accepted Review Batch And Resolution

The explicit configured reviewer profiles were TypeScript/API
`gpt-5.6-terra` / high, style/maintainability `gpt-5.6-terra` / high,
performance/reliability `gpt-5.6-terra` / high, and documentation/TSDoc
`gpt-5.6-luna` / medium. Desktop runtime telemetry does not independently
expose runtime model metadata; these immutable configured profiles are the
available acceptance evidence.

- API P1: added `InterfaceRouteMessage` to the exact server API inventory and
  verified it with `pnpm docs:api:check`.
- API/docs P2: all three `.route(...)` TSDoc blocks now cover schema or nominal
  `MessageInterface` targets, `InterfaceRouteMessage`, exact > first matching
  token registration order > default precedence, copied/malformed/incomplete
  token rejection, and admission-only routing versus durable replay.
- API P2: public compile-time regressions use two-member tokens to prove common
  interface access, reject unconditional member-only access, and retain exact
  schema callback inference across Command, Event, and state-update APIs.
- Style P2: snapshot `forEach` now receives the immutable facade, rather than
  its backing `Map`; a RED/GREEN identity and mutation-surface regression proves
  it.
- Style P2: `RoutingDeclarations` now owns `InterfaceRouteSchemas` and the
  token-candidate classifier, so the three public wrappers retain only their
  signal-specific callback/result types.
- Reliability: CLEAN; no correction was required. Security remains N/A as
  planned, with Wave final security review owned by T-0186.

## Post-Correction Mechanical Evidence

- RED: facade `forEach` leaked its backing map and the common classifier was
  absent. GREEN: 18/18 declaration and public type tests pass.
- Five routing suites pass 262/262 tests; `pnpm typecheck:tooling` and
  `pnpm docs:api:check` pass.
- Full scripted `pnpm test:coverage` passes: 19,532 / 20,505 lines (95.25%),
  12,237 / 13,531 branches (90.44%), and 5,113 / 5,433 functions (94.11%).
- `git diff --check origin/main...HEAD` and the complete
  `pnpm verify:task -- --no-coverage` preflight with the five focused suites
  pass. The correction is ready for targeted re-review; do not run
  `verify:release` before review convergence.

## Targeted API/TSDoc Correction

- Confirming reviewers: TypeScript/API `gpt-5.6-terra` / high and
  documentation/TSDoc `gpt-5.6-luna` / medium. Desktop telemetry does not
  expose independent runtime-model metadata; the immutable configured profiles
  are recorded as acceptance evidence.
- Residual P2: one shared TSDoc block used `@param schemaOrToken`, while the
  overload signatures used `schema` and `token`, producing unbound TypeDoc
  parameter warnings.
- Resolution: each overload and implementation now consistently names its first
  parameter `schemaOrToken`. This changes neither runtime behavior nor the
  public overload types.
- Evidence: corrected `pnpm docs:api`, `pnpm docs:api:check`, tooling typecheck,
  262 focused routing tests, format check, and diff check pass.

## Release Lint Correction

- Release RED: the first post-review `verify:release` stopped at the initial
  full-repository ESLint gate, before any tests. It reported 17 mechanical
  violations in the T-0183 routing changes: four redundant type assertions,
  one mutable declaration, five confusing void-expression callback forms, two
  inconsistent type definitions, one deprecated type matcher, and three unused
  type-test expressions.
- Resolution: removed redundant schema assertions after the shared classifier
  narrows the union; retained the immutable-map facade while using a `const`
  declaration and statement-body callbacks; and normalized only test syntax.
  No routing behavior, persistence, or public contract changed.
- GREEN evidence: `pnpm exec eslint .`; the five focused routing suites
  (262/262); `pnpm typecheck:tooling`; `pnpm docs:api` and
  `pnpm docs:api:check`; `pnpm format:check`; and `git diff --check` pass.
- This is a deterministic release-gate correction, not a specialist-review
  finding. The branch is ready for the orchestrator's final `verify:release`
  attempt; this context did not rerun that profile. Correction checkpoint:
  `b6ca9ab7`.

## Second Release Cleanup Correction

- Release RED: the second `verify:release` attempt cleared full-repository
  ESLint and stopped at cleanup before tests. Cleanup reported the missing
  exact necessity disposition for
  `packages/server/src/repository/routing-declarations.ts:53 readOnlyMap()#1`.
- Resolution: add one exact `necessity` row to the canonical T-0080F
  standalone-function ledger. The row documents the TypeScript
  immutable-collection boundary: `readOnlyMap` builds the frozen facade that
  preserves callback map identity without exposing mutable declaration state.
- GREEN evidence: `pnpm lint:cleanup`, full `pnpm exec eslint .`, the five
  focused routing suites (262/262), `pnpm format:check`, and `git diff --check`
  pass. No behavior, public API, persistence, or replay semantics changed.
- This context did not rerun `verify:release`; the branch is ready for the
  orchestrator's next release-profile attempt.

## Third Release TSDoc Correction

- Release RED: the third `verify:release` attempt cleared full ESLint and
  cleanup, then stopped at `pnpm lint:tsdoc` before tests. All three routing
  APIs needed complete per-overload TSDoc for their exact-schema and
  interface-token declarations. The shared declaration module also lacked
  summaries for `InterfaceRouteSchemas`, the mutable/snapshot declaration
  interfaces, and their route properties.
- Resolution: add concise independent summaries, `@param`, and `@returns`
  documentation to every route overload; add concise internal declaration and
  property summaries. The existing implementation documentation remains the
  single complete explanation of precedence, validation, and durable replay.
- GREEN evidence: `pnpm lint:tsdoc`; `pnpm docs:api` and
  `pnpm docs:api:check`; full `pnpm exec eslint .`; `pnpm lint:cleanup`; the
  five focused routing suites (262/262); `pnpm format:check`; and
  `git diff --check` pass. No behavior, public API shape, persistence, or
  replay semantics changed.
- This context did not rerun `verify:release`; the branch is ready for the
  orchestrator's next release-profile attempt.
