# Review Log: T-0015f Two-Argument Handler Invocation

Status: round 2 clean

Task log: `build-protocol/tasks/T-0015f-two-arg-handlers/TASK.md`
Branch: `task/T-0015f-two-arg-handlers`
Baseline commit: `1a59541`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0015f-two-arg-handlers`

Required review lanes:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability;
- JVM alignment and ADR 0001 compliance.

## Human-Imposed Requirements Under Review

- `handler(signal)` and `handler(signal, context)` are supported for generated
  `@Assign`, `@Command`, `@React`, and `@Subscribe` metadata.
- The second argument is the generated Protobuf context message from the
  incoming signal envelope, not a TS-only framework helper.
- `@Apply` does not get two-argument support.
- End-user handlers return domain messages, not framework envelopes.
- Handler materialization remains framework-owned.
- Keep the API small and avoid overengineered runtime concepts.

## Rounds

- `2026-07-08 00:31 WEST` — Main orchestrator — Created review log.
  - Review will start after the implementation sub-agent reports a candidate
    patch and focused verification.
- `2026-07-08 00:43 WEST` — Implementation sub-agent — Candidate patch ready
  for review.
  - Scope checked against task: canonical metadata now records
    `parameterCount`; generated registry ingestion preserves it; repository
    aggregate command assignees and projection event subscribers pass generated
    `CommandContext`/`EventContext` only for two-argument metadata.
  - `@Apply` remains one-argument only, and the to-do example/runtime reactors
    were not expanded.
  - Focused verification passed:
    `corepack pnpm typecheck:build`;
    focused handler Vitest command;
    focused repository routing Vitest command.
- `2026-07-08 00:50 WEST` — Implementation sub-agent — Final verification
  evidence before handoff.
  - Passed: `corepack pnpm docs:check` (with the existing invalid-origin
    TypeDoc source-link warning), `corepack pnpm lint`,
    `corepack pnpm format:check`, and `git diff --check`.
  - Sandboxed `corepack pnpm test` failed only on local listener/IPC
    permissions (`listen EPERM: operation not permitted 127.0.0.1` and ZeroMQ
    `Operation not permitted`).
  - Approved escalated `corepack pnpm test` passed: 49 test files, 804 tests.
- `2026-07-08 00:51 WEST` — Main orchestrator — Started independent review
  round 1.
  - Reviewers: code style/maintainability; documentation; TypeScript/API docs;
    security; performance/reliability; JVM alignment and ADR 0001 compliance.
  - Scope: validate the candidate patch and durable logs before any commit.
- `2026-07-08 01:04 WEST` — Main orchestrator — Completed independent review
  round 1.
  - Code style/maintainability findings: fix non-monotonic work/review log
    timestamps and wrap overlong Markdown provenance/command lines.
  - Documentation findings: `docs/api/README.md` lacks the T-0015f invocation
    rule and still says runtime loading is deferred.
  - TypeScript/API docs findings: none.
  - Security findings: projection event subscribers share one mutable
    `EventContext` clone across handlers.
  - Performance/reliability findings: same shared `EventContext` issue; add a
    multi-subscriber mutation regression test.
  - JVM alignment/ADR 0001 findings: public explicit handler registration can
    now opt into `parameterCount: 2`; keep the non-default arity path
    framework-owned instead.
- `2026-07-08 01:12 WEST` — Implementation sub-agent — Round-1 fixes applied.
  - Public `HandlerRegistrationBuilder` methods are back to schema plus method
    name only; generated arity preservation now uses framework-owned
    `handlerMetadataAccess.defineArity()`.
  - Projection subscriber invocation now creates a generated `EventContext` per
    subscriber call, with a regression covering mutation isolation between two
    generated two-argument subscribers.
  - `docs/api/README.md` now documents generated `CommandContext`/
    `EventContext` invocation and empty generated context fallback, and no
    longer says registry runtime loading is deferred.
  - Durable task/work/review logs were wrapped and reordered to monotonic
    `2026-07-08` chronology.
- `2026-07-08 01:18 WEST` — Implementation sub-agent — Round-1 focused
  verification completed.
  - Passed: `corepack pnpm typecheck:build`.
  - Passed: affected handler/generated-registry/root-export Vitest command
    covering 36 tests.
  - Passed: focused repository routing Vitest command covering 66 tests.
  - Passed: `corepack pnpm docs:check` with the existing invalid-origin TypeDoc
    source-link warning.
  - Passed: `node scripts/check-cleanup-rules.mjs`.
- `2026-07-08 01:25 WEST` — Main orchestrator — Started independent review
  round 2.
  - Scope: confirm round-1 findings are resolved and no new API, reliability,
    docs, security, style, or JVM-alignment issues were introduced.
- `2026-07-08 01:36 WEST` — Main orchestrator — Completed independent review
  round 2.
  - Code style/maintainability findings: stale review-log status; fixed in
    place.
  - Documentation findings: none.
  - TypeScript/API docs findings: none.
  - Security findings: none.
  - Performance/reliability findings: none.
  - JVM alignment/ADR 0001 findings: none.
- `2026-07-08 02:02 WEST` — Main orchestrator — Applied a post-review
  lint-only style fix.
  - `corepack pnpm lint` initially failed on a shorthand `forEach` callback in
    `packages/server/src/handler/generated-handler-registry.ts`.
  - The callback now uses a block body; `lint`, `format:check`, and
    `git diff --check` pass.
  - A focused style/log recheck is required before commit.
- `2026-07-08 02:08 WEST` — Focused style/log reviewer — Rechecked the
  post-review lint fix and logs.
  - Findings: work-log command line wrapping and current-state wording.
  - Result: production lint fix was clean; work-log findings were applied.
