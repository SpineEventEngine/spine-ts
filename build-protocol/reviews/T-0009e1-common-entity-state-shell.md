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
