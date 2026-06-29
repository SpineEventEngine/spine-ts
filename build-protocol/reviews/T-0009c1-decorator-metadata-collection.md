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

Next step: re-run all five reviewer roles against the fix range.
