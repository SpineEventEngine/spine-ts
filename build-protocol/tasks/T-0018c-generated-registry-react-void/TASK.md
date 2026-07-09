# T-0018c: Generated Registry React Void Alignment

Status: planned
Started: `2026-07-09`
Branch: `task/T-0018c-generated-registry-react-void`
Worktree:
`.worktrees/T-0018c-generated-registry-react-void`
Base commit: `c97f6c3`

## Objective

Align generated-registry analyzer behavior with the documented handler contract
by accepting explicit `void` `@React` handlers as no-emission reactions with
`emittedSchemas: []`.

## Scope

- Update `packages/server/src/handler/build-time-handler-analyzer.ts` so only
  `@Assign` and `@Command` require non-empty emitted schemas.
- Keep `@React` accepting generated event returns or explicit `void`.
- Keep `@Subscribe` requiring explicit `void`.
- Keep `@Assign` and `@Command` rejecting `void` and otherwise empty emitted
  schemas.
- Add focused analyzer tests for no-emission `@React`, emitting `@React`, and
  continued rejection for `@Assign`/`@Command` `void`.
- Do not change runtime handler invocation, writer/discovery shape, registry
  ingestion, descriptor role classification, app examples, transport, metadata
  factories, or public handler APIs beyond the bug fix.

## Human-Imposed Requirements Ledger

- Continue autonomously until all tasks are done or a real blocker appears.
- Keep `human-review-1-jul.md` untouched.
- Use this branch/worktree for this task.
- Spawn one implementation sub-agent for this task.
- Run independent reviewer sub-agents for code style/maintainability,
  documentation, TypeScript/API docs, security, and performance/reliability.
- Feed reviewer comments back and repeat until all lanes are clean.
- Close every participating sub-agent once its role is complete.
- No change may be made without updating the relevant durable log.
- Use installed skills where applicable.
- Preserve end-user handler invariants: handlers return generated domain
  messages, not framework `Event` envelopes; no `@Apply`; no manual end-user
  transactions; no application-owned handler materialization.
- Keep changes simple and JVM-familiar; avoid new abstractions unless they make
  the caller clearly easier to read.

## Acceptance Criteria

- Analyzer returns a valid `event-reaction` record with `emittedSchemas: []`
  for `@React method(event: EventType): void`.
- Existing generated-event-return `@React` behavior remains unchanged.
- `@Assign` and `@Command` still fail closed on `void` or otherwise empty
  emitted schemas.
- `@Subscribe` behavior remains unchanged.
- No generated files are committed.
- Human constraints remain preserved: no `@Apply`, no schema-bearing
  decorators, no framework envelopes in end-user handlers, no manual
  transactions, no application-owned materialization.

## Verification Plan

- Focused RED/GREEN:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/handler/build-time-handler-analyzer.test.ts`.
- `pnpm --config.verify-deps-before-run=false typecheck:build`.
- `pnpm --config.verify-deps-before-run=false docs:check`.
- `pnpm --config.verify-deps-before-run=false format:check`.
- `git diff --check`.
- Full `pnpm --config.verify-deps-before-run=false verify` before integration.
