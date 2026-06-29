# Review Log: T-0009c.1 Decorator Metadata Collection

Task log: `build-protocol/tasks/T-0009c1-decorator-metadata-collection/TASK.md`
Work log: `build-protocol/work-logs/T-0009c1.md`
Branch: `task/T-0009c1-decorator-metadata-collection`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009c1-decorator-metadata-collection`
Baseline commit: `de0860f`

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

Range reviewed: `722a192..39008b7`

Review package:
`.superpowers/sdd/review-722a192..39008b7.diff`

Reviewer sub-agents:

| Role                       | Agent                                  | Result                                                                                                                                                                                              | Disposition |
| -------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Code style/maintainability | `019f1378-1d75-7e53-953c-66e3569b0c2a` | P1 decorator return type rejects normally typed handler methods; P2 function-keyed metadata is not truly class-owned for copied/reused method functions.                                            | Fix needed. |
| Documentation              | `019f1378-1e0d-7541-bd5c-60425f28ccd5` | P3 durable logs contain stale audit markers: authoring agent `TBD`, next-step wording, and review log verification timestamp should align with the final implementation report.                     | Fix needed. |
| TypeScript/API docs        | `019f1378-1e76-7f53-a436-5b72bda747ad` | P1 public `HandlerMethodDecorator`/`HandlerMethodValue` type is too narrow for real typed handler parameters under strict TypeScript; API should be generic over method value/parameters.           | Fix needed. |
| Security                   | `019f1378-1efc-7b50-b9ed-39904947bbfe` | CLEAN: no security findings. Residual risk noted that module-private `WeakMap` should be revisited only if D-0037 requires literal class-owned storage.                                             | Clean.      |
| Performance/reliability    | `019f1378-1f7c-79f2-a64f-31fe92ea0ad0` | P2 function-keyed decorator metadata can be borrowed by another class if a decorated method function is copied/reused on another prototype, weakening class-owned deterministic metadata semantics. | Fix needed. |

Round 1 outcome: not clean. A single fixer handled the consolidated findings;
re-run all five reviewer roles against the fix range.

## Round 1 Fix

Fixer: review-fix sub-agent for `T-0009c.1 Decorator Metadata Collection`

Authoring sub-agent: `019f1368-7ce7-75b3-90e6-b20e86b54e1b`

Implementation commit under review: `39008b7`

Fix commit: `f84ca92`

Fix summary:

- P1 fixed by making `HandlerMethodDecorator` a generic standard method
  decorator call signature over handler `this`, parameter tuple, and return
  type, and by making `HandlerMethodValue` generic over the same shape.
- P2 fixed by replacing method-function-keyed `WeakMap` storage with standard
  per-class decorator metadata, plus own-prototype confirmation during
  materialization.
- P3 fixed by updating durable task/work/review logs and writing
  `ROUND1_FIX_REPORT.md`.

Verification:

- RED `corepack pnpm vitest run packages/server/src/handler-decorators.test.ts`
  failed with TS1241 for a typed decorated handler and with copied-method
  metadata borrowing.
- GREEN `corepack pnpm vitest run packages/server/src/handler-decorators.test.ts`
  passed: 1 test file / 7 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning.
- `CI=true corepack pnpm verify` passed: 12 test files / 82 tests; coverage
  statements 98.72%, branches 91.16%, functions 100%, lines 98.69%; docs/API,
  proto lint/generate, and generated output checks passed with the known
  TypeDoc invalid-origin warning.

Round 1 fix outcome: ready for re-review.

## Follow-Up Rounds

### Round 2

Range reviewed: `a6ce7e9..8a64dde`

Review package:
`.superpowers/sdd/review-a6ce7e9..8a64dde.diff`

Reviewer sub-agents:

| Role                       | Agent                                  | Result                                                                                                                                                                                                    | Disposition |
| -------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Code style/maintainability | `019f1389-33cc-7600-8367-7c8e2a71ad41` | P2 remaining class-owned metadata gap: `readClassDecoratorMetadata()` reads inherited `Symbol.metadata`, allowing an undecorated subclass override to borrow base-class handler metadata.                 | Fix needed. |
| Documentation              | `019f1389-3467-7981-bd2a-63f56ac7a00c` | P3 stale coverage values remain in `TASK.md` coverage section; the tests-run section and fix report have the correct Round 1 final verification coverage.                                                 | Fix needed. |
| TypeScript/API docs        | `019f1389-34d5-73f3-aab1-b3257d9a7aac` | CLEAN: Round 1 P1 is fixed; generic decorator public types support normally typed handlers and semantic compiler tests cover the path.                                                                    | Clean.      |
| Security                   | `019f1389-3551-7a53-8e51-e026cf015e2e` | CLEAN: no security findings; metadata-only behavior preserved and compiler/temp-file/dynamic-import usage remains test-only.                                                                              | Clean.      |
| Performance/reliability    | `019f1389-35de-7422-9e93-cde7426c1e13` | CLEAN: copied/reused method-function borrowing is fixed; deterministic order, class isolation, fallback parity, and registry compatibility are covered; no runtime/transport/storage behavior introduced. | Clean.      |

Round 2 outcome: not clean. Dispatch a focused fixer for the inherited
`Symbol.metadata` own-property guard and stale coverage values, then re-review
the fix.

## Round 2 Fix

Fixer: focused Round 2 fix sub-agent for
`T-0009c.1 Decorator Metadata Collection`

Fix commit: `e480a33`

Fix summary:

- Added a focused regression test for a decorated base class and an
  undecorated subclass that overrides the same method name, proving subclass
  materialization must not borrow base-class handler metadata.
- Changed `readClassDecoratorMetadata()` to read only the entity constructor's
  own `Symbol.metadata` property descriptor before consuming decorator records.
- Updated the stale `TASK.md` coverage section to the Round 1 final
  verification evidence: 12 test files / 82 tests; coverage statements 98.72%,
  branches 91.16%, functions 100%, lines 98.69%.

Verification:

- RED `corepack pnpm vitest run packages/server/src/handler-decorators.test.ts`
  failed on `2026-06-29 14:26 WEST` with the expected subclass override
  metadata borrowing assertion.
- GREEN
  `corepack pnpm vitest run packages/server/src/handler-decorators.test.ts`
  passed on `2026-06-29 14:26 WEST`: 1 test file / 8 tests.
- After adding explicit `unknown` narrowing for
  `Object.getOwnPropertyDescriptor().value`, GREEN was rerun on
  `2026-06-29 14:28 WEST`: 1 test file / 8 tests.
- `corepack pnpm typecheck` passed on `2026-06-29 14:27 WEST`.
- `corepack pnpm docs:check` passed on `2026-06-29 14:27 WEST` with the known
  TypeDoc invalid-origin warning.
- First Round 2 `CI=true corepack pnpm verify` failed at lint because
  `Object.getOwnPropertyDescriptor().value` is typed as `any`.
- Final Round 2 `CI=true corepack pnpm verify` passed on
  `2026-06-29 14:29 WEST`: 12 test files / 83 tests; coverage statements
  98.72%, branches 91.16%, functions 100%, lines 98.69%; docs/API,
  proto lint/generate, and generated output checks passed with the known
  TypeDoc invalid-origin warning.

Round 2 fix outcome: committed as `e480a33` plus log commit `e5e4f66`;
reviewed in Round 3.

### Round 3

Range reviewed: `2bac3b6..e5e4f66`

Review package:
`.superpowers/sdd/review-2bac3b6..e5e4f66.diff`

Reviewer sub-agents:

| Role                       | Agent                                  | Result                                                                                                                                                 | Disposition |
| -------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| Code style/maintainability | `019f1397-045d-7872-9106-45d97f0ba391` | P3 stale work-log resume guidance after Round 2 fix commit. Code fix confirmed clean.                                                                  | Fix needed. |
| Documentation              | `019f1397-04e3-7fa3-b54f-710a00efeb9a` | P3 stale post-fix wording in `ROUND2_FIX_REPORT.md`, work log, and review log; stale task header reviewer status. Coverage values confirmed corrected. | Fix needed. |
| TypeScript/API docs        | `019f1397-0572-7100-8a0f-49e9bcb049d8` | CLEAN: own-property metadata lookup and generic decorator types are TypeScript-clean; no legacy decorator metadata or parameter decorators introduced. | Clean.      |
| Security                   | `019f1397-05da-78d0-883f-cde5e15e5c7c` | CLEAN: focused fix adds no secrets, unsafe filesystem/network/process behavior, handler invocation, storage, transport, or global handler registry.    | Clean.      |
| Performance/reliability    | `019f1397-065c-71c0-b48f-3193c3c0ba7c` | CLEAN: inherited metadata borrowing is blocked without harming deterministic own-class materialization; focused decorator tests passed independently.  | Clean.      |

Round 3 outcome: code and API changes are clean, but audit-log wording needs a
small cleanup before final review closure.
