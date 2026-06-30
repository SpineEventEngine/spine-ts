# Implementation Report: T-0009e.3 Family Capability Marker Classes

Status: Implemented; Round 2 Fixes Applied; Follow-up Review Pending
Task log:
`build-protocol/tasks/T-0009e3-family-capability-marker-classes/TASK.md`
Work log: `build-protocol/work-logs/T-0009e3.md`
Review log:
`build-protocol/reviews/T-0009e3-family-capability-marker-classes.md`
Branch: `task/T-0009e3-family-capability-marker-classes`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009e3-family-capability-marker-classes`
Setup commit: `54c670b`
Parent baseline before setup: `26aa510`

## Summary

Implemented the first public `@spine-ts/server` entity family capability marker
classes:

- `Aggregate<Id, Schema, Version>`;
- `Projection<Id, Schema, Version>`;
- `ProcessManager<Id, Schema, Version>`; and
- `EntityFamily`, a minimal `"aggregate" | "projection" | "process-manager"`
  marker union.

Each family class is an abstract subclass of
`TransactionalEntity<Id, Schema, Version>` and adds only a stable locked own
`entityFamily` marker. No repository, storage, dispatch, command posting, query
client, event history, snapshot, process workflow, handler invocation,
idempotency, lifecycle event, automatic version increment, or global transaction
behavior was added.

## JVM Research Used

The required JVM files were inspected before implementation:

- `Aggregate.java`: extends an assignee-capable transactional base and owns or
  collaborates with command dispatch, event history, idempotency, applier
  watching, lifecycle columns, and repository snapshot behavior. These runtime
  capabilities were intentionally deferred.
- `Projection.java`: directly extends JVM `TransactionalEntity` and adds
  event-playing/subscriber/repository behavior outside this TypeScript slice.
- `ProcessManager.java`: extends an assignee-capable transactional base and adds
  event reaction, command production/substitution, query client, bounded-context,
  and process-manager model behavior. These runtime capabilities were
  intentionally deferred.
- `TransactionalEntity.java`: provides protected transaction access, changed
  state, lifecycle flag delegation, and scoped mutation behavior. The existing
  TypeScript `TransactionalEntity` already models the safe subset used here.
- `Entity.java` and `AbstractEntity.java`: confirm the common entity identity,
  state, version, lifecycle, and model-family concepts; TypeScript keeps the
  current explicit constructor/options shape instead of adding Java builders.

## TDD Record

RED tests were added first in `packages/server/src/entity.test.ts` and
`packages/server/src/index.test.ts` to require:

- root exports for `Aggregate`, `Projection`, and `ProcessManager`;
- inheritance from `TransactionalEntity`;
- stable `entityFamily` identities and `EntityFamily` typing;
- runtime immutability of family identity under JavaScript reassignment attempts;
- inherited transaction/snapshot behavior through a test aggregate subclass; and
- transaction-scope operations remaining absent from the public family class
  types.

The RED run failed as expected because the classes were not implemented or
exported:

- `corepack pnpm vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  failed with `Class extends value undefined is not a constructor or null` and
  missing root export assertions.

After the minimal implementation and export updates, the targeted GREEN run
passed:

- `corepack pnpm vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  passed: 2 test files, 36 tests.

## Round 1 Fix Pass

Round 1 review found that the initial `readonly entityFamily = ...` markers
compiled to writable own properties at runtime. The family markers now use
getter-only literal accessors, with narrow lint suppressions explaining why the
accessor form is required instead of the repository's usual literal-field
style.

`packages/server/src/entity.test.ts` now includes an explicit runtime
immutability test that attempts JavaScript reassignment with `Reflect.set()` and
asserts the reported family remains unchanged for aggregate, projection, and
process manager instances.

The durable T-0009e.3 and parent T-0009e logs were also updated to reflect that
implementation completed, Round 1 produced findings, and follow-up review is
still pending.

## Round 2 Fix Pass

Round 2 review found that the inherited getter marker still allowed reflective
own-property shadowing with `Object.defineProperty(instance, "entityFamily",
...)`, and that the prototype accessor remained configurable. The family
classes now install a non-configurable, non-writable own `entityFamily` marker
from each base constructor while preserving the literal TypeScript type for each
family.

`packages/server/src/entity.test.ts` now covers:

- `Reflect.set()` reassignment attempts;
- `Object.defineProperty(instance, "entityFamily", { value: ... })` spoofing
  attempts;
- the locked own descriptor shape; and
- prototype descriptor tampering not changing existing or newly constructed
  aggregate markers.

The durable T-0009e.3 and parent T-0009e status headers were updated to state
that Round 2 fixes are applied and follow-up review is still pending.

## Files Changed

- `packages/server/src/entity.ts`
- `packages/server/src/entity.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `scripts/check-api-docs.mjs`
- `packages/server/README.md`
- `docs/api/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `build-protocol/tasks/T-0009e3-family-capability-marker-classes/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009e3.md`
- `build-protocol/reviews/T-0009e3-family-capability-marker-classes.md`
- `build-protocol/tasks/T-0009e-entity-base-classes/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009e.md`
- `build-protocol/reviews/T-0009e-entity-base-classes.md`

## Verification

- Baseline `CI=true corepack pnpm verify` passed before implementation on
  `2026-06-30 01:59 WEST` after `corepack pnpm install` hydration.
- Targeted RED/GREEN verification is recorded above.
- Final `CI=true corepack pnpm verify` passed on `2026-06-30 02:11 WEST`:
  typecheck, lint, format check, 15 test files / 156 tests, coverage, TypeDoc
  API export check with 72 expected server exports, proto lint/generate, and
  generated-output clean checks all completed successfully. TypeDoc reported the
  existing invalid `origin` remote warning only.
- Round 1 fix targeted verification passed on `2026-06-30 02:23 WEST`:
  `corepack pnpm vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 37 tests.
- Round 1 fix full verification passed on `2026-06-30 02:23 WEST`:
  `CI=true corepack pnpm verify` passed typecheck, lint, format check, 15 test
  files / 157 tests, coverage, TypeDoc/API export checks with 72 expected server
  exports, proto lint/generate, and generated-output clean checks. TypeDoc
  reported the existing invalid `origin` remote warning only.
- Round 2 RED verification passed as a regression check on
  `2026-06-30 02:31 WEST`: `corepack pnpm vitest run
packages/server/src/entity.test.ts` failed with the expected
  `Object.defineProperty()` spoofing and missing own-descriptor assertions.
- Round 2 focused GREEN verification passed on `2026-06-30 02:31 WEST`:
  `corepack pnpm vitest run packages/server/src/entity.test.ts` passed with 1
  test file / 29 tests.
- Round 2 required targeted verification passed on `2026-06-30 02:34 WEST`:
  `corepack pnpm vitest run packages/server/src/entity.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 38 tests.
- Round 2 required full verification passed on `2026-06-30 02:34 WEST`:
  `CI=true corepack pnpm verify` passed typecheck, lint, format check, 15 test
  files / 158 tests, coverage statements 97.25%, branches 91.41%, functions
  99.16%, lines 97.19%, TypeDoc/API export checks with 72 expected server
  exports, proto lint/generate, and generated-output clean checks. TypeDoc
  reported the existing invalid `origin` remote warning only.

## Review

Round 1 review completed across the required lanes and produced findings:

- code style/maintainability, security, and performance/reliability found that
  the original `readonly entityFamily = ...` class fields were runtime-mutable
  own properties after TypeScript emit;
- documentation found durable log status drift that still described
  implementation or review as pending.

This report was updated as part of the Round 1 fix pass. A follow-up review
round is still required before this subtask can be called clean.

Round 2 review then found that inherited getter markers remained forgeable via
reflective own-property definition and prototype mutation. The Round 2 fix is
applied and awaiting follow-up review; this report does not claim a clean final
review.

## Concerns

None at implementation time. The only deliberate limitation is the task scope:
the new public classes are family markers over `TransactionalEntity` and do not
provide runtime aggregate/projection/process-manager infrastructure.
