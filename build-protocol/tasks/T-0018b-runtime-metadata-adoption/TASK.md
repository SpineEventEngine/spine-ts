# T-0018b: Runtime Metadata Adoption

Status: integrated on main
Started: `2026-07-09`
Branch: `task/T-0018b-runtime-metadata-adoption`
Worktree:
`.worktrees/T-0018b-runtime-metadata-adoption`
Base commit: `e62de1a`
Task commit: `9647963`
Merge commit: `348ff95`

## Objective

Adopt the `SignalMetadata` runtime seam in the public example, test helpers,
and testing documentation so ordinary command metadata is not hand-rolled in
example or test code.

## Scope

- Update to-do example command-posting docs and smoke snippets to use
  `SignalMetadata` for generated command IDs and command/actor context
  creation.
- Update example test helpers to use `SignalMetadata` or one narrow helper
  built on it instead of repeated `CommandIdSchema` + `CommandContextSchema` +
  `ActorContextSchema` assembly.
- Update `@spine-ts/testing` documentation to show the same metadata seam.
- Add a tiny helper only if direct `SignalMetadata` use remains noisy and the
  helper makes callers clearer.
- Keep `packCommand()` and `packEvent()` available as low-level helpers.
- Do not broaden into a client DSL, global registry loading, auth, transport
  changes, handler materialization, or runtime redesign.

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

- Public to-do example command-posting docs no longer hand-roll ordinary
  actor/tenant command context creation.
- Example/test helpers use `SignalMetadata` or one narrow helper built on it for
  routine command metadata construction.
- No end-user/example handler invariant regresses: handlers still return domain
  messages; no framework envelopes, no `@Apply`, no manual transactions.
- Documentation clearly distinguishes the metadata seam from low-level envelope
  packing.
- Focused tests, static checks, and full verification pass before integration
  or a real blocker is recorded.

## Verification Plan

- `pnpm --config.verify-deps-before-run=false exec vitest run
examples/todo/src/index.test.ts
packages/testing/test/index.test.ts
packages/server/test/runtime/signal-metadata.test.ts`.
- `pnpm --config.verify-deps-before-run=false typecheck:build`.
- `pnpm --config.verify-deps-before-run=false docs:check`.
- `pnpm --config.verify-deps-before-run=false format:check`.
- `git diff --check`.
- Full `pnpm --config.verify-deps-before-run=false verify` before integration.
