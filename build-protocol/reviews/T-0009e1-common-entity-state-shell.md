# Review Log: T-0009e.1 Common Entity State Shell

Task log: `build-protocol/tasks/T-0009e1-common-entity-state-shell/TASK.md`
Work log: `build-protocol/work-logs/T-0009e1.md`
Branch: `task/T-0009e1-common-entity-state-shell`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009e1-common-entity-state-shell`
Baseline commit: `ae5110c`

## Review Requirements

Every review round must include separate sub-agents for:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

Reviewers must inspect the committed range for this subtask, report findings
with file/line references when possible, and explicitly state whether their
role is clean. The orchestrator must close every reviewer after result capture.

## Round 1

Implementation commit under review: `4ade81d`.

Review result captured on `2026-06-29 22:26 WEST`: changes requested.

| Role                       | Reviewer ID                            | Result               | Closure |
| -------------------------- | -------------------------------------- | -------------------- | ------- |
| Code style/maintainability | `019f154a-a3a7-78a0-9361-dfdc4de25a52` | P2 finding           | Closed  |
| Documentation              | `019f154a-a522-70f0-ab3e-ab184a3df71c` | P2 finding           | Closed  |
| TypeScript/API docs        | `019f154a-a58a-7c21-9d2a-52b4efbfee2d` | Clean                | Closed  |
| Security                   | `019f154a-a607-73d3-9ce8-b35e2c39d2c9` | Low finding          | Closed  |
| Performance/reliability    | `019f154a-a67f-74f0-9ac0-1dbf7252ae14` | Duplicate P2 finding | Closed  |

Findings:

- P2: `packages/server/src/entity.ts` stores `options.version` by reference and
  the public `version` getter returns the same reference. Object-shaped version
  metadata can be mutated through the constructor object or getter result,
  creating a public mutation path outside `replaceVersionMetadata()`.
- P2: durable task, work, and review logs retained stale pre-commit language
  after implementation commit `4ade81d` existed.

Clean-role evidence:

- TypeScript/API docs reported no findings, ran
  `pnpm exec tsc -p packages/server/tsconfig.json --noEmit --pretty false`,
  and ran `node scripts/check-api-docs.mjs`, confirming 62 expected
  `@spine-ts/server` exports.
- Security found no hidden IO, storage, transport, dispatch, global state,
  sensitive log payloads, auth headers, tokens, or raw stored state dumps.
- Performance/reliability found no runtime concerns in `entity.ts`; cloning is
  synchronous and scoped, lifecycle-change tracking is deterministic and
  sticky, and no async, timers, process-global mutation, or runtime behavior was
  added.

Both findings were accepted and routed to this focused fix pass.

## Round 1 Fix Route

Review-fix implementation started on `2026-06-29 22:36 WEST` from review
capture commit `bff6e5e`.

Accepted findings:

- P2: object-shaped `Version` metadata must not be mutable through constructor
  input, the public `version` accessor, or protected replacement input.
- P2: durable task, work, review, and report logs must not retain live stale
  pre-commit wording after implementation commit `4ade81d`.

Fix route:

- Add focused RED regressions for constructor/getter and protected replacement
  version metadata aliasing.
- Store and return cloned structured-clone-compatible object version metadata
  while leaving primitive version metadata as value-like caller-owned data.
- Update durable task/report/work/review logs to record the accepted findings
  and remove live stale pre-commit wording.

Verification:

- RED focused check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts` failed on
  `2026-06-29 22:35 WEST` as expected: 1 test file / 8 tests, with 2 failures
  covering constructor/getter and protected replacement version metadata
  aliasing.
- GREEN focused check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts` passed on
  `2026-06-29 22:36 WEST`: 1 test file / 8 tests.
- Focused root/API check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 22:37 WEST`: 2 test files / 17 tests.
- Targeted stale-marker search for live implementation-precommit wording in
  T-0009e.1 task/report/work/review logs found no matches on
  `2026-06-29 22:37 WEST`.
- `corepack pnpm typecheck` passed after correcting explicit mutable test
  casts; `corepack pnpm lint` passed; `corepack pnpm format:check` passed after
  formatting the edited work log.
- `CI=true corepack pnpm verify` passed on `2026-06-29 22:38 WEST`: 15 test
  files / 137 tests; coverage statements 97.7%, branches 90.72%, functions
  100%, lines 97.65%; TypeDoc/API/proto gates passed.

## Round 2

Review-fix commit under review: `aef6297`.

Review result captured on `2026-06-29 22:49 WEST`: changes requested.

| Role                       | Reviewer ID                            | Result     | Closure                         |
| -------------------------- | -------------------------------------- | ---------- | ------------------------------- |
| Code style/maintainability | `019f1557-55e2-7a12-86c7-eec7a4b23038` | Clean      | Closed                          |
| Documentation              | `019f1557-566f-7b03-ad67-9c22d765177a` | Clean      | Closed                          |
| TypeScript/API docs        | `019f1557-56e5-7c10-9b1f-3b126051b5a8` | Clean      | Closed                          |
| Security                   | `019f1557-5760-7233-ae49-8cd1ad61bb7f` | P2 finding | No longer addressable from root |
| Performance/reliability    | `019f1557-57e6-7390-a176-69c6fd914f5e` | P2 finding | No longer addressable from root |

Findings:

- P2: `cloneVersionMetadata()` relies on `structuredClone()` for all
  object-shaped metadata. `SharedArrayBuffer`-backed typed arrays can preserve a
  shared backing-memory mutation path even after structured cloning, so version
  metadata can still be mutated through constructor input, getter output, or
  protected replacement input when callers provide shared-memory values.
- P2: `structuredClone()` is too permissive and too surprising for the
  unconstrained generic `Version` contract. Function-valued metadata throws
  `DataCloneError`; custom class instances can lose their prototype while still
  being typed as `Version`.

Clean-role evidence:

- Code style/maintainability reported no findings after the round 1 fix.
- Documentation reported no stale pending markers and no documentation issues.
- TypeScript/API docs reported no findings, ran
  `corepack pnpm exec tsc --noEmit -p packages/server/tsconfig.json`,
  `corepack pnpm exec tsc --noEmit -p tsconfig.eslint.json`,
  `node scripts/check-api-docs.mjs`, and focused entity tests.

Both P2 findings are accepted. The fix route is to make version metadata a
plain snapshot data contract instead of accepting arbitrary object graphs:

- define the accepted `Version` shape as primitive/array/plain-object snapshot
  data;
- replace `structuredClone()` with a small explicit recursive clone that rejects
  functions, class instances, typed arrays, `ArrayBuffer`, `SharedArrayBuffer`,
  and other non-plain objects;
- add focused regressions for rejected shared-memory and prototype-bearing
  metadata;
- update public docs and API docs if a public error/type is introduced.

## Round 2 Fix Route

Review-fix implementation started on `2026-06-29 22:52 WEST` from Round 2
review capture commit `4f52d08`.

Accepted findings:

- P2: version metadata must not retain a mutation path through shared backing
  memory such as `SharedArrayBuffer`-backed typed arrays.
- P2: version metadata must not rely on `structuredClone()` semantics for
  functions or prototype-bearing objects.

Fix route:

- Add focused RED regressions for rejected non-plain metadata, including a
  `SharedArrayBuffer`-backed typed array and a custom class instance.
- Cover nested plain metadata isolation through constructor input, getter
  output, and protected replacement input.
- Export `EntityVersionMetadata` as the plain snapshot data contract and update
  public docs/API export gates.
- Replace `structuredClone()` with explicit recursive clone/validation for
  primitives, `null`, arrays, and plain objects only.

Verification:

- RED focused check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts` failed on
  `2026-06-29 22:52 WEST` as expected: 1 test file / 10 tests, with 1 failure
  because non-plain version metadata was still accepted.
- GREEN focused root/API check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 22:56 WEST`: 2 test files / 19 tests.
- `corepack pnpm typecheck` passed; first `corepack pnpm lint` found 3 strict
  TypeScript issues in the helper, and the rerun passed after typed
  path/prototype fixes.
- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed with the expected broken-origin TypeDoc
  warning and 63 expected `@spine-ts/server` exports.
- `CI=true corepack pnpm verify` passed on `2026-06-29 23:03 WEST`: 15 test
  files / 139 tests; coverage statements 97.69%, branches 91.24%, functions
  100%, lines 97.64%; TypeDoc/API/proto gates passed and generated proto output
  was clean.

## Round 3

Round 2 fix commit under review: `50a1802`.

Review result captured on `2026-06-29 23:11 WEST`: changes requested.

| Role                       | Reviewer ID                            | Result      | Closure |
| -------------------------- | -------------------------------------- | ----------- | ------- |
| Code style/maintainability | `019f156b-68f2-7963-a16b-068b1b817e9f` | Clean       | Closed  |
| Documentation              | `019f156b-697e-7e81-b9e5-608e6bebac9d` | Clean       | Closed  |
| TypeScript/API docs        | `019f156b-69f2-7241-a5f5-78af0bd16749` | P2 finding  | Closed  |
| Security                   | `019f156b-6a75-7382-823a-ee56a5a4cb00` | Findings    | Closed  |
| Performance/reliability    | `019f156b-6af3-7de1-9871-47eeda8c4fcd` | P2/P3 finds | Closed  |

Findings:

- P2: `Entity` and `EntityOptions` still leave `Version` unconstrained, so
  callers can compile `Entity<Id, Schema, Date>` even though runtime rejects
  non-plain version metadata. The public generic contract must enforce
  `EntityVersionMetadata`.
- Medium/P2: array version metadata cloning uses `Array.prototype.map()`, which
  can consult caller-controlled species/constructor behavior and can execute
  accessor elements. Array metadata must be validated and cloned through
  descriptors without invoking caller code.
- Medium/P2: plain-object cloning assigns `clone[key] = ...`, allowing an own
  enumerable `__proto__` data property to mutate the clone prototype instead of
  preserving plain snapshot data.
- Low/Medium: rejection labels read `value.constructor.name`, which can execute
  caller-controlled constructor getters for rejected objects.
- P2: deep but otherwise plain metadata can throw a raw `RangeError` from JS
  stack overflow. The clone must either be iterative or reject excessive nesting
  with the same domain error.
- P3: array own properties are silently dropped because the array branch does
  not run descriptor validation for custom own keys.

Clean-role evidence:

- Code style/maintainability found the state shell still scoped to ID/schema,
  metadata, state, version, lifecycle accessors, and protected replacement hooks
  only, with no repository, dispatch, storage, handler invocation, routing, bus,
  transaction, or global runtime expansion.
- Documentation found no stale status, inaccurate docs, missing review-loop
  evidence, or docs implying repository/runtime behavior.

All findings are accepted. The fix route is to harden plain metadata cloning
without adding new runtime surface:

- constrain `Version` generics to `EntityVersionMetadata`;
- validate arrays by descriptors, reject accessors/symbol keys/non-enumerable
  props/custom own props, and clone elements without `map()`;
- clone object properties with `Object.defineProperty()` or reject
  prototype-affecting keys so own `__proto__` cannot change prototypes;
- stop reading caller-controlled `constructor` properties for error labels;
- add a maximum nesting-depth rejection or equivalent iterative clone;
- add focused RED regressions for the accepted cases and rerun the review loop.

## Round 3 Fix Route

Review-fix implementation started on `2026-06-29 23:13 WEST` from Round 3
review capture commit `a54c198`.

Accepted findings:

- P2/API: `Entity` and `EntityOptions` version generics must reject non-plain
  metadata such as `Date` at compile time.
- P2/security/reliability: version metadata cloning must not invoke caller
  array species, accessors, or constructor getters; must not mutate clone
  prototypes through JSON `__proto__`; must not silently drop array own
  properties; and must not surface raw stack overflows for excessive nesting.

Fix route:

- Add focused RED regressions for array species/accessor/custom-property
  hazards, JSON `__proto__`, constructor getter label safety, deep metadata
  rejection, and `Date` generic exclusion.
- Constrain `EntityOptions` and `Entity` `Version` parameters to
  `EntityVersionMetadata`.
- Clone arrays from validated property descriptors without
  `Array.prototype.map()`, rejecting accessor, symbol-keyed, non-enumerable,
  sparse, subclassed, or custom-property arrays.
- Clone plain-object data properties with `Object.defineProperty()` so own
  `__proto__` remains data and cannot change clone prototypes.
- Use bounded recursion for plain metadata and safe built-in labels that do not
  read caller-controlled `constructor` properties.

Verification:

- RED focused check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts` failed on
  `2026-06-29 23:13 WEST` as expected: 1 test file / 15 tests, with 4 failures
  covering array descriptor hazards, JSON `__proto__`, constructor getter label
  safety, and deep metadata stack overflow.
- RED `corepack pnpm typecheck` failed on `2026-06-29 23:13 WEST` as expected
  after test-shape cleanup because the `Date` generic `@ts-expect-error`
  assertions were unused.
- GREEN focused check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts` passed on
  `2026-06-29 23:16 WEST`: 1 test file / 15 tests.
- `corepack pnpm typecheck` passed on `2026-06-29 23:16 WEST`.
- `corepack pnpm lint` first failed on `2026-06-29 23:18 WEST` because test
  metadata aliases violated the repo's interface preference; after adding
  explicit plain-data index signatures to interfaces, rerun passed.
- `corepack pnpm format:check` first found the edited work log on
  `2026-06-29 23:18 WEST`; after formatting that file, rerun passed.
- `corepack pnpm docs:check` passed on `2026-06-29 23:18 WEST` with the
  expected broken-origin TypeDoc warning and 63 expected server exports.
- `CI=true corepack pnpm verify` passed on `2026-06-29 23:19 WEST`: 15 test
  files / 144 tests; coverage statements 97.3%, branches 91.24%, functions
  100%, lines 97.24%; TypeDoc/API/proto gates passed and generated proto output
  was clean.

## Round 4

Round 3 fix commit under review: `7bcb7f8`.

Review result captured on `2026-06-29 23:25 WEST`: changes requested.

| Role                       | Reviewer ID                            | Result     | Closure |
| -------------------------- | -------------------------------------- | ---------- | ------- |
| Code style/maintainability | `019f157a-8682-7d41-acfb-36250edfcdbe` | Clean      | Closed  |
| Documentation              | `019f157a-86fa-72a0-9734-72f6f57c6762` | Clean      | Closed  |
| TypeScript/API docs        | `019f157a-8762-7b61-a3a2-869413db1b6a` | P2 finding | Closed  |
| Security                   | `019f157a-87eb-7ad3-b0c5-706e0b790534` | P2 finding | Closed  |
| Performance/reliability    | `019f157a-8860-79b0-8df7-e2553dfd6254` | Clean      | Closed  |

Findings:

- P2/API: the `Version extends EntityVersionMetadata` constraint rejects valid
  plain metadata interfaces unless callers add an explicit string index
  signature. The type contract should reject non-plain types such as `Date`
  while accepting ordinary named interfaces with plain fields.
- P2/security: proxy objects can still execute caller-controlled traps during
  validation because reflective checks such as `Object.getPrototypeOf()` and
  `Object.getOwnPropertyDescriptors()` are reached before any proxy rejection.
  This task accepts explicit runtime rejection before reflective inspection.

Clean-role evidence:

- Code style/maintainability found the Round 3 fix scoped to private metadata
  helpers, focused tests, and durable logs only, with no runtime-scope creep.
- Documentation found no stale status, inaccurate verification evidence,
  missing Round 4 readiness, or public wording implying repository/runtime
  behavior.
- Performance/reliability confirmed deep metadata now rejects with the domain
  `TypeError`, arrays do not drop custom own properties silently, nested plain
  metadata still clones, and normal metadata clone cost remains linear and
  bounded by depth.

Both findings are accepted. The fix route is:

- replace the index-signature generic bound with a recursive mapped/conditional
  type contract that accepts normal plain interfaces and rejects non-plain
  values such as `Date`;
- add compile-time regressions for both accepted plain interfaces and rejected
  non-plain metadata;
- reject Node proxies before reflective object/array validation, using an
  intrinsic check such as `util.types.isProxy()`;
- add a focused runtime regression proving proxy traps are not invoked.

## Round 4 Fix Evidence

Focused fix implemented on `2026-06-29 23:38 WEST`.

- RED: `corepack pnpm typecheck` failed against the old generic bound after
  removing the test-only index signature from `RevisionMetadata` and
  `NestedRevisionMetadata`.
- RED: `corepack pnpm test packages/server/src/entity.test.ts` failed the proxy
  regression because a proxy trap was invoked before the plain-snapshot domain
  error.
- GREEN: `corepack pnpm typecheck` passed after adding
  `PlainEntityVersionMetadata` input validation and preserving compile-time
  rejection for `Date`.
- GREEN: focused entity/root tests passed 2 files / 25 tests after proxies were
  rejected before reflective validation.
- Final verification: root-session focused entity/root tests, typecheck, lint,
  format check, and docs check passed after replacing a non-typechecked
  `node:util` import with the local `process.getBuiltinModule()` declaration and
  adding `PlainEntityVersionMetadata` to the API gate. Final full verify passed
  with 15 test files / 145 tests, coverage 97.31% statements / 91.28% branches /
  100% functions / 97.25% lines, 64 expected server exports, TypeDoc/API and
  proto gates passed, and generated proto output clean.

## Round 5

Round 4 fix commits under review: `362f62e..258d361`.

Review result captured on `2026-06-29 23:57 WEST`: changes requested.

| Role                       | Reviewer ID                            | Result     | Closure |
| -------------------------- | -------------------------------------- | ---------- | ------- |
| Code style/maintainability | `019f1594-5fbd-71d0-a8d0-7c8392f7d3c8` | P2/P3      | Closed  |
| Documentation              | `019f1594-604f-7c90-a1a7-2fcbd9a12f8f` | P2 finding | Closed  |
| TypeScript/API docs        | `019f1594-60d6-7973-8dbc-848bf987a042` | Clean      | Closed  |
| Security                   | `019f1594-6156-7ac2-9d42-be11f0b73bec` | Clean      | Closed  |
| Performance/reliability    | `019f1594-61ec-77b3-98d7-3637107626b7` | Clean      | Closed  |

Findings:

- P2: `EntityVersionMetadata` still used a property-name denylist through the
  broad public generic bound. Otherwise plain metadata interfaces with fields
  such as `size`, `clear`, `then`, or `apply` could still be rejected, even
  though runtime plain-object cloning accepts them.
- P2/P3: durable top-level statuses still said `Round 4 Review Fix Required`,
  and the task log still described the fourth pass as queued or ready for commit
  even though the fix had been verified and committed.

Clean-role evidence:

- TypeScript/API confirmed ordinary plain metadata interfaces without index
  signatures compile, `Date` remains rejected at `EntityOptions` input
  boundaries, root exports and API gate include `PlainEntityVersionMetadata`,
  and focused TypeScript/Vitest/API checks pass.
- Security confirmed proxy metadata is rejected before reflective inspection,
  proxy traps are covered by regression tests, and the earlier
  array/accessor/species, `__proto__`, constructor-label, and shared-buffer
  findings remain fixed.
- Performance/reliability found no cost or brittleness issues in the
  type-only helper or Node `isProxy()` runtime path under the repo's Node
  `>=24` requirement.

Both findings are accepted. The fix route is:

- make the broad `EntityVersionMetadata` object arm intentionally broad and let
  `PlainEntityVersionMetadata<T>` perform the precise recursive validation at
  entity input positions;
- add a regression for an otherwise plain interface with a `size` field;
- update stale durable statuses and current-state wording;
- rerun focused tests, typecheck, format/lint/docs, and full verification.

## Round 5 Fix Evidence

Focused fix implemented and verified on `2026-06-30 00:02 WEST`.

- `EntityVersionMetadata` now uses a property-name-neutral object arm; precise
  structural validation remains in `PlainEntityVersionMetadata<T>` at entity
  input positions.
- Added a compile-time regression for a plain metadata interface with a `size`
  field, while retaining the `Date` input rejection regression.
- Updated task/report/work-log status wording so the durable state reflected the
  then-current next review checkpoint after the Round 5 implementation.
- `CI=true corepack pnpm verify` passed with 15 test files / 145 tests,
  coverage 97.31% statements / 91.28% branches / 100% functions / 97.25% lines,
  TypeDoc/API/proto gates passed with 64 expected server exports, and generated
  proto output clean.

## Round 6

Round 5 fix commit under review: `c79f925`.

Review result captured on `2026-06-30 00:06 WEST`: changes requested.

| Role                       | Reviewer ID                            | Result     | Closure |
| -------------------------- | -------------------------------------- | ---------- | ------- |
| Code style/maintainability | `019f15a0-2960-7193-a732-20af83680980` | P3 finding | Closed  |
| Documentation              | `019f15a0-29e2-7220-88b0-f00c817f0e74` | P2/P3      | Closed  |
| TypeScript/API docs        | `019f15a0-2a71-77c3-a30b-2d6f19545657` | Clean      | Closed  |
| Security                   | `019f15a0-2aef-7703-ab6e-65e3162f26bc` | Clean      | Closed  |
| Performance/reliability    | `019f15a0-2b6a-7e31-88ed-87fa0b8ae9f3` | Clean      | Closed  |

Findings:

- P2/P3: work-log current-state wording still said the Round 4 fix was ready
  for Round 5 review even though Round 5 was complete and ready for Round 6.
- P3: the implementation report status had advanced to the next review
  checkpoint, but the report did not include the Round 5 fix verification
  evidence already present in the review/work logs.

Clean-role evidence:

- TypeScript/API confirmed plain metadata interfaces with fields such as `size`
  now compile, `Date` remains rejected at `EntityOptions` input boundaries,
  runtime non-plain rejection remains covered, and the API gate still reports 64
  server exports.
- Security confirmed the Round 5 type broadening did not weaken runtime
  clone/rejection behavior for functions, proxies, buffers, dates, maps, sets,
  classes, accessors, symbol keys, `__proto__`, or cycles.
- Performance/reliability confirmed the broad type change is type-only and
  runtime depth/proxy behavior remains unchanged.

Both findings are accepted. The fix route is docs-only:

- update the work-log current-state bullet for Round 4 to describe completed
  Round 5 review/fix history rather than readiness for Round 5;
- add the Round 5 fix verification evidence to the implementation report;
- run docs/format checks and rerun the required review loop.

## Round 6 Fix Evidence

Docs-only fix implemented and verified on `2026-06-30 00:08 WEST`.

- Work-log current-state wording no longer says the Round 4 fix is ready for
  Round 5 review after Round 5 completed.
- Implementation report now records the Round 5 fix and verification evidence.
- `CI=true corepack pnpm verify` passed with 15 test files / 145 tests,
  coverage 97.31% statements / 91.28% branches / 100% functions / 97.25% lines,
  TypeDoc/API/proto gates passed with 64 expected server exports, and generated
  proto output clean.

## Round 7

Round 6 docs-only fix commit under review: `a6a3791`.

Review result captured on `2026-06-30 00:14 WEST`: changes requested.

| Role                       | Reviewer ID                            | Result     | Closure |
| -------------------------- | -------------------------------------- | ---------- | ------- |
| Code style/maintainability | `019f15a5-c637-76a0-82c9-eac15866faf5` | P2/P3      | Closed  |
| Documentation              | `019f15a5-c6b3-7f71-9516-ef822db26d2a` | P2 finding | Closed  |
| TypeScript/API docs        | `019f15a5-c71f-7760-b833-d57157c78e32` | P3 finding | Closed  |
| Security                   | `019f15a5-c7b8-7271-9410-868316f12505` | Clean      | Closed  |
| Performance/reliability    | `019f15a5-c828-7b00-a81d-32108b7590ea` | P3 finding | Closed  |

Findings:

- P2/P3: task/report top-level status and task/work-log current-state text still
  described earlier review readiness after the Round 6 docs-only fix had already
  been implemented and verified.
- P3: open-risk routing still pointed the stale durable-status follow-up at the
  prior review checkpoint instead of recording the Round 6 review/fix outcome.

Clean-role evidence:

- Security confirmed the docs-only cleanup did not affect runtime security
  behavior or weaken the plain metadata rejection contract.
- TypeScript/API confirmed the public API surface, export gate, and
  `PlainEntityVersionMetadata` documentation remained unchanged except for stale
  status wording.
- Performance/reliability confirmed no runtime or test-performance behavior
  changed in the docs-only diff.

Both findings are accepted. The fix route is docs-only:

- update task/report status lines to reflect Round 7 fix implemented and Round 8
  review pending;
- update task/work-log current-state and open-risk routing so Round 5 and Round
  6 are recorded as reviewed/fixed history;
- run docs/format/full verification and rerun the required review loop.

## Round 7 Fix Evidence

Docs-only fix implemented and verified on `2026-06-30 00:17 WEST`.

- Task/report/work-log current-state wording now records Round 5 as fixed and
  reviewed in Round 6, Round 6 as fixed and reviewed in Round 7, and this
  Round 7 docs-only cleanup as pending Round 8 review.
- Open-risk routing records the stale Round 4 status issue as fixed/reviewed and
  adds the Round 7 stale-status cleanup as the active Round 8 review point.
- `corepack pnpm docs:check` passed with the expected invalid-origin TypeDoc
  warning and 64 expected server exports.
- `corepack pnpm format:check` passed with all matched files using Prettier
  style.
- `CI=true corepack pnpm verify` passed with 15 test files / 145 tests, coverage
  97.31% statements / 91.28% branches / 100% functions / 97.25% lines,
  TypeDoc/API/proto gates passed with 64 expected server exports, and generated
  proto output clean.
