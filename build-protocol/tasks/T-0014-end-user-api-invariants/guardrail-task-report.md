# T-0014 Guardrail Task Report

status: DONE_WITH_CONCERNS

files changed:

- `scripts/check-cleanup-rules.mjs`
- `scripts/check-cleanup-rules.test.mjs`
- `build-protocol/tasks/T-0014-end-user-api-invariants/TASK.md`
- `build-protocol/tasks/T-0014-end-user-api-invariants/guardrail-task-report.md`
- `build-protocol/work-logs/T-0014.md`
- `build-protocol/reviews/T-0014-end-user-api-invariants.md`

tests/commands run with pass/fail result:

- `corepack pnpm install` — PASS
- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — PASS
- `node scripts/check-cleanup-rules.mjs` — INTENTIONAL_FAIL
  - Evidence: fails on `examples/todo/src/index.ts`, which still uses the known
    forbidden end-user API patterns this guardrail is meant to expose.

concerns:

- The repository-level cleanup guard remains red until the main T-0014 example
  migration removes the existing violations from `examples/todo/src/index.ts`.

## 2026-07-07 review-fix pass

status: DONE_WITH_CONCERNS

files changed:

- `scripts/check-cleanup-rules.mjs`
- `scripts/check-cleanup-rules.test.mjs`
- `build-protocol/tasks/T-0014-end-user-api-invariants/guardrail-task-report.md`

tests/commands run with pass/fail result:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — PASS
- `node scripts/check-cleanup-rules.mjs` — INTENTIONAL_FAIL
  - Evidence: fails on `examples/todo/src/index.ts` for the known end-user API
    violations; the checker no longer crashes and no longer fails on its own
    script line-length rule.

concerns:

- The repository-level cleanup guard remains intentionally red until the main
  T-0014 example migration removes the existing forbidden patterns from
  `examples/todo/src/index.ts`.

## 2026-07-07 round-4 local fix pass

status: DONE_WITH_CONCERNS

files changed:

- `scripts/check-cleanup-rules.mjs`
- `scripts/check-cleanup-rules.test.mjs`
- `build-protocol/tasks/T-0014-end-user-api-invariants/TASK.md`
- `build-protocol/work-logs/T-0014.md`
- `build-protocol/reviews/T-0014-end-user-api-invariants.md`
- `build-protocol/tasks/T-0014-end-user-api-invariants/guardrail-task-report.md`

tests/commands run with pass/fail result:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — PASS
  25/25
- `node scripts/check-cleanup-rules.mjs` — INTENTIONAL_FAIL
  - Evidence: fails on `examples/todo/src/index.ts` for the known end-user API
    violations only.

changes:

- Reconciled task-local status drift after round-4 documentation review.
- Replaced raw return-type source diagnostics with bounded resolved labels.
- Recursed through framework `Event`/`Command` return containers and aliases.
- Tracked aliased and namespaced framework-owned helper imports.
- Scanned nested `examples/**/src` files.
- Rejected destructured command target parameters and ignored nested callbacks
  that rebind the command parameter.

concerns:

- The cleanup guard's command target extraction check is intentionally a static
  heuristic for the obvious `id`/`target` cases. Full default-route validation
  is owned by the runtime/generated metadata slice, where protobuf descriptors
  and custom-route opt-out are available.
- The repository-level cleanup guard remains intentionally red until the main
  T-0014 example migration removes the existing forbidden patterns from
  `examples/todo/src/index.ts`.

next state:

- Guardrail round-5 re-review pending.

## 2026-07-07 round-5 local fix pass

status: DONE_WITH_CONCERNS

files changed:

- `scripts/check-cleanup-rules.mjs`
- `scripts/check-cleanup-rules.test.mjs`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/tasks/T-0014-end-user-api-invariants/TASK.md`
- `build-protocol/work-logs/T-0014.md`
- `build-protocol/reviews/T-0014-end-user-api-invariants.md`
- `build-protocol/tasks/T-0014-end-user-api-invariants/guardrail-task-report.md`

tests/commands run with pass/fail result:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — PASS
  32/32
- `node scripts/check-cleanup-rules.mjs` — INTENTIONAL_FAIL
  - Evidence: fails on `examples/todo/src/index.ts` for the known end-user API
    violations only.

changes:

- Added a bounded work budget to recursive return-type scanning and avoided a
  second scan for the diagnostic label.
- Ignored type-only server imports for decorator/value provenance.
- Recognized `.cts` import-equals framework namespaces.
- Narrowed namespace-qualified proto return checks to `Event` and `Command`.
- Detected computed `command["id"]` and `command["target"]` target extraction.
- Limited the static target-extraction heuristic to `@Assign`; generated
  metadata/runtime validation will own broader first-field route enforcement.
- Reworded developer API transaction docs to match non-event-sourced aggregate
  behavior from ADR 0001.

concerns:

- The repository-level cleanup guard remains intentionally red until the main
  T-0014 example migration removes the existing forbidden patterns from
  `examples/todo/src/index.ts`.

next state:

- Guardrail round-6 re-review pending.

## 2026-07-07 round-6 local fix pass

status: DONE_WITH_CONCERNS

files changed:

- `scripts/check-cleanup-rules.mjs`
- `scripts/check-cleanup-rules.test.mjs`
- `build-protocol/tasks/T-0014-end-user-api-invariants/TASK.md`
- `build-protocol/work-logs/T-0014.md`
- `build-protocol/reviews/T-0014-end-user-api-invariants.md`
- `build-protocol/tasks/T-0014-end-user-api-invariants/guardrail-task-report.md`

tests/commands run with pass/fail result:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — PASS
  36/36
- `node scripts/check-cleanup-rules.mjs` — INTENTIONAL_FAIL
  - Evidence: fails on `examples/todo/src/index.ts` for the known end-user API
    violations only.

changes:

- Split example guardrail collection into smaller file-resolution, API-scan, and
  failure-grouping helpers.
- Changed command target checks to reject validation-helper calls such as
  `requireTaskId(command.id)`, while allowing ordinary domain use of
  `command.id`.
- Added type-only proto import-equals and import-equals member alias coverage.
- Added wrapper unwrapping for validation arguments such as `command!.id` and
  `(command as TaskCommand).id`.
- Reported too-deep type graphs honestly as `handler return type too deep to
audit`.

concerns:

- The repository-level cleanup guard remains intentionally red until the main
  T-0014 framework/example migration removes the existing forbidden patterns
  from `examples/todo/src/index.ts`.

next state:

- Guardrail round-7 re-review pending.

## 2026-07-07 round-3 local fix pass

status: DONE_WITH_CONCERNS

files changed:

- `scripts/check-cleanup-rules.mjs`
- `scripts/check-cleanup-rules.test.mjs`
- `build-protocol/tasks/T-0014-end-user-api-invariants/TASK.md`
- `build-protocol/work-logs/T-0014.md`
- `build-protocol/reviews/T-0014-end-user-api-invariants.md`
- `build-protocol/tasks/T-0014-end-user-api-invariants/guardrail-task-report.md`

tests/commands run with pass/fail result:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — PASS
  19/19
- `node scripts/check-cleanup-rules.mjs` — INTENTIONAL_FAIL
  - Evidence: fails on `examples/todo/src/index.ts` for the known end-user API
    violations only.

concerns:

- The repository-level cleanup guard remains intentionally red until the main
  T-0014 example migration removes the existing forbidden patterns from
  `examples/todo/src/index.ts`.

## 2026-07-07 round-2 local fix pass

status: DONE_WITH_CONCERNS

files changed:

- `scripts/check-cleanup-rules.mjs`
- `scripts/check-cleanup-rules.test.mjs`
- `build-protocol/tasks/T-0014-end-user-api-invariants/TASK.md`
- `build-protocol/work-logs/T-0014.md`
- `build-protocol/reviews/T-0014-end-user-api-invariants.md`
- `build-protocol/tasks/T-0014-end-user-api-invariants/guardrail-task-report.md`

tests/commands run with pass/fail result:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — PASS
  19/19
- `node scripts/check-cleanup-rules.mjs` — INTENTIONAL_FAIL
  - Evidence: fails on `examples/todo/src/index.ts` for the known end-user API
    violations only.

concerns:

- The repository-level cleanup guard remains intentionally red until the main
  T-0014 example migration removes the existing forbidden patterns from
  `examples/todo/src/index.ts`.

## 2026-07-07 round-7 local fix pass

status: DONE_WITH_CONCERNS

files changed:

- `scripts/check-cleanup-rules.mjs`
- `scripts/check-cleanup-rules.test.mjs`
- `build-protocol/tasks/T-0014-end-user-api-invariants/TASK.md`
- `build-protocol/work-logs/T-0014.md`
- `build-protocol/reviews/T-0014-end-user-api-invariants.md`
- `build-protocol/tasks/T-0014-end-user-api-invariants/guardrail-task-report.md`

tests/commands run with pass/fail result:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — PASS
  39/39
- `node scripts/check-cleanup-rules.mjs` — INTENTIONAL_FAIL
  - Evidence: fails on `examples/todo/src/index.ts` for the known end-user API
    violations only.

changes:

- Resolved import-equals member aliases after namespace collection, making their
  declaration order irrelevant.
- Tracked type-only proto member aliases such as
  `import type LegacyEvent = Proto.Event`.
- Rejected validation-helper calls through simple local aliases of command
  `id`/`target` fields.

concerns:

- The repository-level cleanup guard remains intentionally red until the main
  T-0014 framework/example migration removes the existing forbidden patterns
  from `examples/todo/src/index.ts`.

## 2026-07-07 round-8 local fix pass

status: DONE_WITH_CONCERNS

files changed:

- `scripts/check-cleanup-rules.mjs`
- `scripts/check-cleanup-rules.test.mjs`
- `build-protocol/tasks/T-0014-end-user-api-invariants/TASK.md`
- `build-protocol/work-logs/T-0014.md`
- `build-protocol/reviews/T-0014-end-user-api-invariants.md`
- `build-protocol/tasks/T-0014-end-user-api-invariants/guardrail-task-report.md`

tests/commands run with pass/fail result:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — PASS
  43/43
- `node scripts/check-cleanup-rules.mjs` — INTENTIONAL_FAIL
  - Evidence: fails on `examples/todo/src/index.ts` for the known end-user API
    violations only.

changes:

- Split import provenance into focused helpers.
- Ignored mixed type-only core helper imports in value API checks.
- Resolved import-equals namespace aliases with a fixed-point pass.
- Enforced explicit handler return type rules for decorators.
- Honored simple block shadowing for command target validation aliases.

concerns:

- The repository-level cleanup guard remains intentionally red until the main
  T-0014 framework/example migration removes the existing forbidden patterns
  from `examples/todo/src/index.ts`.

## Final Current State

status: DONE

latest verification:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — PASS
  82/82
- `node scripts/check-cleanup-rules.mjs` — PASS after the framework/example
  migration removed the checked-in to-do violations.
- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs
examples/todo/src/index.test.ts packages/server/test/repository/repository-routing.test.ts`
  — PASS 148/148 before the coverage additions.
- `corepack pnpm vitest run packages/server/test/handler/handler-decorators.test.ts
packages/server/test/repository/repository-routing.test.ts scripts/check-cleanup-rules.test.mjs
examples/todo/src/index.test.ts` — PASS 160/160 when rerun escalated after the
  sandbox-only `listen EPERM 127.0.0.1` failure.
- `corepack pnpm test` — PASS 725/725 before the coverage additions.
- `corepack pnpm test:coverage` — PASS 729/729, 95.11% statements, 90.31%
  branches.
- `corepack pnpm lint` — PASS.
- `corepack pnpm format:check` — PASS.
- `corepack pnpm typecheck:build` — PASS.
- `corepack pnpm docs:check` — PASS with only the known invalid-origin source-link
  warning.
- `git diff --check` — PASS

next state:

- Round-15 reviewer sub-agents over the full migration diff.

latest changes:

- Rejected import-type framework envelope returns and chained import-equals
  envelope aliases.
- Rejected local example declarations of
  `materializeDecoratedEntityHandlers`.
- Propagated command target validation aliases while respecting nested callback
  alias shadowing.
- Respected inner-scope local decorators that shadow imported Spine decorator
  names.
- Rejected local value aliases of Spine decorators, invalid explicit emitting
  handler return types, block-local envelope aliases, non-domain return aliases,
  and recursive return aliases.
- Respected function-parameter decorators and binding-pattern callback
  shadowing.
- Required generated Protobuf import provenance for emitted message return
  types.
- Rejected rest-only tuple returns and unknown qualified return types.
- Tracked namespace aliases, namespace destructuring, and object-literal aliases
  of framework decorators/helpers.
- Respected nested block shadowing of the command parameter name.
- Accepted generated namespace/value imports as handler return provenance.
- Respected local type alias shadowing over imported generated/proto names.
- Tracked destructured object-literal decorator aliases.
- Rejected object-wrapped command target validation aliases.
- Applied target-validation guardrails to command-transforming `@Command`
  handlers while preserving event-to-command handler allowance.
- Accepted labeled non-empty tuple/rest returns.
- Classified generated handler returns by signal family, rejecting generated
  commands from `@Assign`/`@React` and generated events from `@Command`.
- Detected generated command inputs for `@Command` route guardrails through
  namespaced and local-aliased generated command types.
- Propagated command target validation aliases through command object aliases
  and object destructuring.
- Confined authored-code symlinks before reading tracked package/script files.
- Removed recursive package `src` traversal from package-test checking.
- Tracked object-held namespace aliases such as `container.core.packEvent`.
- Rejected destructured command parameters, computed target destructuring, and
  wrapped command objects in target-validation helpers.
- Made conflicting import-equals aliases terminate deterministically.
- The to-do example no longer uses framework `Event` returns, schema-bearing
  decorators, aggregate `@Apply`, transaction-control calls, internal event ID
  construction, default-route ID validation helpers, or local handler
  materialization.
- Framework repository execution now owns aggregate/projection transactions for
  the new domain-message flow and packs aggregate-returned domain events into
  internal framework events.
- Managed aggregate storage validates event batches before managed snapshot
  writes, and public docs now keep legacy event application/materialization
  vocabulary out of the ordinary application path.
