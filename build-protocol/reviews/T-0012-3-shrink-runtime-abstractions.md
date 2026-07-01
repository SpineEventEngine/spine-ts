# Review Log: T-0012.3 Delete Or Shrink Abandoned Runtime Abstractions

Task log:
`build-protocol/tasks/T-0012-3-shrink-runtime-abstractions/TASK.md`
Branch: `task/T-0012-3-shrink-runtime-abstractions`
Baseline commit: `cb5ace3`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-3-shrink-runtime-abstractions`
Status: All review lanes clean; final verification passed

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Focus

Reviewers must enforce `D-0047`, `CODE_QUALITY.md`, and the reset constraints:

- removed abstractions are actually gone or materially smaller;
- no replacement framework behavior is added before the roadmap reaches it;
- API shrinkage is documented and deliberate;
- public standalone helpers are not introduced;
- transport still hides ZeroMQ and keeps only the needed bus abstraction;
- cleanup enforcement remains intact.

## Current Notes

Implementation sub-agent removed the ahead-of-roadmap runtime abstractions and
updated focused tests, API docs, cleanup checks, and public export count
expectations.

Deleted or shrunk concepts recorded by the implementer:

- bounded context runtime shell and built snapshot alias;
- bounded context repository registration structured detail exports;
- repository identity structured detail payloads;
- transport lifecycle participant/worker snapshot helpers;
- transport delivery attempt/result/failure/retry helper family;
- runtime routing dependence on transport worker registration keys.

Deliberately kept concepts:

- bounded context metadata, repository registration, and snapshot support;
- core transport signal/topic/subscription and publish/request/respond
  abstractions;
- runtime routing descriptors as deferred metadata without delivery/runtime
  execution behavior.

Public API counts changed deliberately:

- `server`: `130` exports to `122`;
- `transport`: `46` exports to `17`.

Verification recorded by the implementer:

- focused server/transport Vitest slice passed: 5 files, 81 tests;
- sandbox `corepack pnpm test` and `env CI=true corepack pnpm verify` failed
  only on ZeroMQ `ipc://` permission errors;
- native/escalated `corepack pnpm test` passed: 28 files, 291 tests;
- native/escalated `env CI=true corepack pnpm verify` passed, including lint,
  typecheck, tests, docs check, proto generation, and generated proto check.

Independent review lanes remain pending.

## Review Findings And Fixes

- Documentation medium: `docs/USER_GUIDE.md` still showed
  `runtime.start()` / `runtime.close()` after the bounded-context runtime shell
  was removed. Fixed by deleting those stale lines from the routing-plan
  example.
- Architecture docs low: `docs/architecture/README.md` still described
  correlation to top-level topic/subscription/worker arrays. Fixed wording to
  name topic/subscription arrays and planner-local worker IDs.
- Server README low: `packages/server/README.md` described structured
  `RepositoryIdentityError` codes and details. Fixed wording to simple
  code/message diagnostics.
- Security medium:
  `packages/server/src/context/bounded-context.ts` exposed context, entity
  constructor, and state type names in conflict messages. Fixed by using the
  generic message `Bounded context already has conflicting repository
ownership.` with only `code` for branching.
- Security low: `packages/server/src/repository/repository.ts` appended
  rejected schema `typeName` values to public schema mismatch messages. Fixed
  by removing that detail and deleting the unused helper.
- Cleanup follow-up: deleting that helper shifted existing cleanup-rule
  exception line numbers in `scripts/check-cleanup-rules.mjs`; fixed those
  pinned locations without changing the rule.

Review-fix focused verification passed:
`corepack pnpm exec vitest run packages/server/test/context/bounded-context.test.ts packages/server/test/repository/repository.test.ts`
reported 2 files and 52 tests passed.

Review-fix final verification passed:
`corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm docs:check`,
and `git diff --check` passed. Sandboxed `corepack pnpm test` failed only the
known ZeroMQ `ipc://` permission path with 289 of 291 tests passing; native
`corepack pnpm test` passed 28 files and 291 tests.

## Second Re-review Findings And Fixes

- Documentation low: `docs/USER_GUIDE.md` still said
  `RepositoryIdentityError` had stable codes and structured details. Fixed to
  stable code/message diagnostics.
- Security low: `packages/server/src/repository/repository.ts` still included
  the rejected schema full type name and entity kind in the valid-schema/
  wrong-family mismatch message. Fixed with a generic supplied-schema mismatch
  message and a focused test assertion that the rejected type name and kind are
  absent.
- Documentation low: `packages/server/README.md` still had stale routing-plan
  wording about top-level topic/subscription arrays only. Fixed to describe
  correlation keys for topic/subscription arrays and planner-local worker IDs.

Second re-review verification passed:
`corepack pnpm exec vitest run packages/server/test/repository/repository.test.ts`
reported 1 file and 16 tests passed. `corepack pnpm exec prettier --write`
passed for touched markdown, source, and test files. `corepack pnpm lint`,
`corepack pnpm typecheck`, `corepack pnpm docs:check`, and
`git diff --check` passed; docs check reported only the known TypeDoc
invalid-origin warning.

## Final Focused Documentation Re-review

Focused package:
`.superpowers/sdd/review-worklog-9080c49..1ead356.diff`.

Reviewer `019f1f12-e51e-7c20-a70a-3a2b5cc3740a` reported `CLEAN` and is
closed. All required review lanes are clean.
