# Review Log: T-0009d.1 Built-In Set-Once Transition Validation

Task log: `build-protocol/tasks/T-0009d1-set-once-transition-validation/TASK.md`
Work log: `build-protocol/work-logs/T-0009d1.md`
Branch: `task/T-0009d1-set-once-transition-validation`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009d1-set-once-transition-validation`
Baseline commit: `1d939d7`

## Review Requirements

Every review round must include separate sub-agents for:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

Reviewers must inspect the committed range for this task, report findings with
file/line references when possible, and explicitly state whether their role is
clean. The orchestrator must close every reviewer after result capture.

## Round 1

Reviewer package: `.superpowers/sdd/review-cd98ca3..e32f906.diff`.

Important findings addressed in fix round 1:

- Security: `entity-transition-validation.ts` used normal property lookup for
  set-once fields, allowing inherited or accessor-backed forged fields to
  influence comparison.
- Security: nested object equality accepted arbitrary non-null object shapes and
  ignored prototype identity/non-plain objects.
- Documentation: root `README.md` still described validation integration as
  deferred.
- Reliability: recursive equality had no cycle detection or recursion-depth
  guard.

Minor findings addressed in fix round 1:

- Replaced schema-invalid bytes/array/nested object equality coverage with
  descriptor-valid set-once fixture fields, leaving only explicitly forged
  unsupported-shape hardening tests as casts.
- Expanded TypeDoc comments for the transition validation request and public
  validator.
- Added coverage for default-to-non-default existing-state set-once changes.

Fix commit: `70c0052`.
Verification:

- `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 19 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning.
- `CI=true corepack pnpm verify` passed with 13 test files / 93 tests; coverage
  statements 98.48%, branches 92.34%, functions 100%, lines 98.44%; docs/API
  and proto checks passed with the known TypeDoc invalid-origin warning.

## Round 2

Reviewer package: `.superpowers/sdd/review-cd98ca3..70c0052.diff`.

Important findings addressed in fix round 2:

- Code semantics: missing own set-once fields were treated as unsafe even when
  both previous and next descriptor-valid states omitted an optional singular
  message field. The required semantics are absent-on-both compares equal,
  absent-to-present and present-to-absent fail, and inherited/accessor-backed
  forged values still fail closed without raw value leakage.
- Durable logs: `TASK.md`, `build-protocol/work-logs/T-0009d1.md`, and this
  review log had stale placeholders or current-state wording after `70c0052`.
- API docs: `docs/api/README.md` did not mention that server transition
  validation now exists in the current-status paragraph.

Fix-round 2 entry:

- Added a RED descriptor-valid test for `RichSetOnceState.details` absent from
  both previous and next states.
- Updated set-once field reads to treat truly absent own fields as safe missing
  values while preserving fail-closed handling for inherited and accessor-backed
  fields.
- Refreshed task, work-log, review-log, implementation report, and API status
  documentation.

Verification:

- RED
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected with 1 of 11 tests failing.
- GREEN
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 20 tests.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts.
- `corepack pnpm typecheck` passed.
- `CI=true corepack pnpm verify` first failed on work-log formatting; after
  Prettier cleanup, `CI=true corepack pnpm verify` passed with 13 test files /
  94 tests and coverage statements 98.48%, branches 92.46%, functions 100%,
  lines 98.45%.

## Follow-Up Rounds

Round 2 findings are addressed in fix round 2. No later reviewer round is
recorded in durable evidence yet.
