# T-0016h Review Log

Status: complete

Scope: to-do example final readiness, focused example tests, user/developer
guide accuracy, and forbidden end-user API surface checks.

Review note: all required reviewer lanes must be run by separate sub-agents.
Each participating implementation, fix, and reviewer sub-agent must be closed
after its role is complete.

## Required Lanes

| Lane                       | Status                   | Result                                                                                                |
| -------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| Code style/maintainability | Fix applied and verified | USER_GUIDE subscription snippet no longer drifts from the README topic context shape.                 |
| Documentation completeness | Fix applied and verified | README now includes focused test commands and compact command/query/subscription client instructions. |
| TypeScript/API docs        | Fix applied and verified | USER_GUIDE subscription snippet now includes required TopicSchema context.                            |
| Security                   | Fix applied and verified | Public README and USER_GUIDE commands no longer recommend dependency-verification bypasses.           |
| Performance/reliability    | Fix applied and verified | README smoke script drains the pending subscription update promise during cleanup.                    |

Final clean re-review agents:

- Style: `019f42c6-63b6-7ab2-8e5f-351742aebe9c`.
- Documentation: `019f42c6-64ce-7b11-9fa3-ca5096438bb3`.
- TypeScript/API docs: `019f42c6-6545-7ad3-97a1-6b9c7c6180e0`.
- Security: `019f42c6-6601-7563-a827-675b633aef8f`.
- Performance/reliability: `019f42c6-66eb-7603-98ec-000b483b3f7a`.

## Findings

- Documentation completeness: `examples/todo/README.md` was too dependent on
  `USER_GUIDE.md` for runnable usage. It needed copy-pasteable focused test
  commands plus command/query/subscription client instructions directly in the
  README. Fix applied in the documentation review-fix pass by adding a focused
  test block and a compact local client smoke script that posts a command,
  reads the `TaskList` projection, receives one subscription update, and
  cancels the subscription. The README retains the `127.0.0.1` local-only
  binding caveat and the process-local in-memory storage caveat.

  Fix verification: `pnpm --config.verify-deps-before-run=false format:check`,
  `pnpm --config.verify-deps-before-run=false docs:check`, and
  `git diff --check` passed on rerun after formatting the updated Markdown
  logs.

- Security: end-user docs recommended
  `pnpm --config.verify-deps-before-run=false ...` commands. Fix applied by
  removing the bypass from `examples/todo/README.md` and
  `examples/todo/USER_GUIDE.md` public commands and adding concise
  `pnpm install` prerequisite text. Internal build-protocol logs retain the
  bypass only as historical execution evidence.

- TypeScript/API docs: the `examples/todo/USER_GUIDE.md` subscription snippet
  created `TopicSchema` without the required actor context. Fix applied by
  importing `ActorContextSchema` and `UserIdSchema` and adding
  `TopicSchema.context`, matching the README smoke script.

- Performance/reliability: the `examples/todo/README.md` smoke script created
  `nextUpdate` before command/query work but did not observe it on failure
  paths. Fix applied by making the promise mutable and optional, starting it
  inside the guarded block, and draining/catching it in `finally` after
  subscription cancellation and iterator return.

  Second-round fix verification: `pnpm format:check` initially caught Markdown
  wrapping in this review log and the implementation report, `pnpm format`
  rewrote those files, and the rerun of `pnpm format:check` passed.
  `pnpm docs:check` passed with the existing invalid-`origin` TypeDoc warning
  and 0 errors. `git diff --check` passed. The focused
  `pnpm vitest run examples/todo/src/index.test.ts --passWithNoTests` run was
  blocked in the managed sandbox by `listen EPERM` on `127.0.0.1`; the native
  loopback rerun passed with 1 file and 19 tests.
  Orchestrator also reran public-form verification after `corepack pnpm
install`: `pnpm typecheck:build`, `pnpm format:check`, `pnpm docs:check`,
  `git diff --check`, and native focused Vitest passed. Exact fixed-port README
  smoke verification was not rerun because an unrelated Java process was
  already listening on TCP port 8080 and was left untouched.

## Review Policy

- Every formal reviewer lane must be run by a separate sub-agent.
- Findings must be fed back to an authoring/fix sub-agent.
- Re-review continues until all lanes are clean before integration.
- All participating sub-agents must be closed after their result is recorded.
