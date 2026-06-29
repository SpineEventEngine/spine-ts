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

## Round 3

Reviewer package: `.superpowers/sdd/review-cd98ca3..01cfb47.diff`.

Important findings addressed in fix round 3:

- Security: bytes and repeated set-once equality trusted user-controlled
  collection methods and indexed reads. Forged arrays, `Uint8Array`s, and
  proxies could make changed values appear stable through overridden `every`,
  inherited or accessor indexes, or proxy reads.
- Durable logs: `TASK.md` and `build-protocol/work-logs/T-0009d1.md` still
  described fix round 2 as in progress after committed fix-round 2 commit
  `01cfb47`.
- Review log: round 3 findings and the current fix round were not yet recorded.
- Coverage docs: `TASK.md` latest coverage needed to match the latest full
  verification evidence.
- Implementation report: `Files Changed` omitted files changed across the task,
  including root `README.md`, this review log, and server fixture/proto files.
- README: root `README.md` still called `docs/USER_GUIDE.md` a placeholder.

Fix-round 3 entry:

- Added RED tests for forged bytes/repeated set-once collections with overridden
  `every`, typed-array and repeated proxy reads, inherited repeated indexes, and
  accessor-backed repeated indexes.
- Hardened bytes comparison around intrinsic typed-array copying and dense own
  data descriptors, rejecting forged/proxied/extra-property byte values.
- Hardened repeated comparison around dense own data descriptors and explicit
  loops, rejecting inherited/accessor indexes, extra methods, sparse arrays,
  symbol keys, and changed prototypes without leaking previous/next values.
- Refreshed task, work-log, review-log, implementation report, and root README
  documentation for committed `01cfb47` and this fix round.

Verification:

- RED
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected with 2 of 13 tests failing.
- GREEN
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 22 tests.
- `corepack pnpm docs:check` first failed on a helper type, then passed with the
  known TypeDoc invalid-origin warning and expected API export counts.
- `corepack pnpm typecheck` first failed on helper/test-helper types, then
  passed.
- `CI=true corepack pnpm verify` first failed on lint, then formatting; after
  cleanup, `CI=true corepack pnpm verify` passed with 13 test files / 96 tests
  and coverage statements 97.34%, branches 90.72%, functions 100%, lines
  97.26%.

## Round 4

Reviewer package: `.superpowers/sdd/review-cd98ca3..3ccca04.diff`.

Important findings addressed in fix round 4:

- Security: top-level set-once field reads still trusted
  proxy-trappable reflection values from `Object.getOwnPropertyDescriptor()` and
  `in`, allowing a proxy to report a stable descriptor while Protobuf
  serialization would expose a changed set-once value.
- Security: nested message comparison had the same reflection-bypass class
  through `Object.getPrototypeOf()`, `Object.keys()`, and descriptor reads.
- Reliability: `Object.is(previousValue, nextValue)` returned before hardened
  object/collection validation, allowing same-reference unsupported objects or
  forged collections to pass.
- Performance: bytes comparison copied bytes and then materialized `number[]`
  arrays before comparison.
- Coverage/docs: direct absent-to-present and present-to-absent singular message
  set-once coverage was missing, `TASK.md` needed to record fix commit
  `3ccca04`, `TASK.md` itself was missing from the file inventory, and durable
  logs needed this fix round.

Fix-round 4 entry:

- Added RED tests for proxy-forged top-level descriptors, proxy-forged nested
  message descriptors, same-reference unsupported object/collection values, and
  absent-to-present/present-to-absent singular message set-once transitions.
- Changed field reads to use descriptor checks only for unsafe-shape gating,
  then read and canonicalize the actual Protobuf field value through a
  Protobuf-ES binary round-trip before comparison.
- Removed the object/collection same-reference equality shortcut while keeping
  primitive identity short-circuiting.
- Compared safe `Uint8Array` copies directly instead of building intermediate
  JS `number[]` arrays.
- Refreshed task, work-log, review-log, and implementation-report bookkeeping
  after committed fix-round 3 commit `3ccca04`.

Verification:

- RED
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  failed as expected with 3 failing tests.
- GREEN
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 28 tests after adding the final coverage cases.
- `corepack pnpm typecheck` passed.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts.
- `corepack pnpm lint` and `corepack pnpm format:check` initially failed; after
  cleanup, focused tests, lint, and format check passed.
- `CI=true corepack pnpm verify` first failed on branch coverage; after focused
  coverage for symbol-keyed repeated collections, throwing nested proxies, and
  subclassed bytes, `corepack pnpm test:coverage` passed with 13 test files /
  102 tests and coverage statements 96.79%, branches 90.09%, functions 100%,
  lines 96.71%.
- Final `CI=true corepack pnpm verify` passed with 13 test files / 102 tests;
  coverage statements 96.79%, branches 90.09%, functions 100%, lines 96.71%;
  docs/API and proto checks passed with the known TypeDoc invalid-origin
  warning.

## Round 5

Reviewer package: `.superpowers/sdd/review-cd98ca3..e2369cc.diff`.

Important findings addressed in fix round 5:

- Reliability/security: `Object.getOwnPropertyDescriptor()` in
  `readFieldValue()` was outside a `try`, so throwing top-level proxy
  reflection produced core's generic rule-failed violation without `fieldPath`
  instead of a field-specific set-once violation.
- API contract: map-valued `(set_once)` fields were always unsafe, while docs
  implied unchanged set-once values pass. This fix round keeps maps unsupported
  for the task and documents/reports that public boundary explicitly.
- Coverage: cyclic/too-deep recursive equality and same-reference unsupported
  object coverage still used forged scalar `id` values instead of
  descriptor-backed nested message set-once field `RichSetOnceState.details`.
- Durable logs: latest coverage numbers, current state after `e2369cc`, task
  end time, review log, work log, and implementation report needed the current
  fix round recorded.

Fix-round 5 entry:

- Added RED tests for throwing top-level proxy reflection, descriptor-valid
  map-valued set-once fields, descriptor-backed recursive
  `RichSetOnceState.details` cycle/depth handling, and descriptor-backed
  same-reference unsupported message values.
- Caught top-level field descriptor reflection failures in `readFieldValue()` as
  unsafe field reads, preserving field-specific set-once violations without raw
  value or proxy error leakage.
- Kept map-valued `(set_once)` fields unsupported and made the violation/docs
  explicit for that public contract.
- Refreshed durable task, work-log, review-log, implementation-report, and
  public documentation after committed fix-round 4 commit `e2369cc`.

Verification:

- RED
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  failed as expected with 2 failing tests after the cyclic forged-state test
  setup was corrected to exercise the validator.
- GREEN
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 31 tests.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts.
- `corepack pnpm typecheck` passed.
- `CI=true corepack pnpm verify` passed with 13 test files / 105 tests and
  coverage statements 97.12%, branches 91.07%, functions 100%, lines 97.05%.

## Follow-Up Rounds

Round 5 findings are addressed in fix round 5. No later reviewer round is
recorded in durable evidence yet.
