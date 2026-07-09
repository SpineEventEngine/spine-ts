# T-0018d: Generated Registry Descriptor Roles

Status: planned
Started: `2026-07-09`
Branch: `task/T-0018d-generated-registry-descriptor-roles`
Worktree:
`.worktrees/T-0018d-generated-registry-descriptor-roles`
Base commit: TBD

## Objective

Replace generated-registry analyzer command/event role classification based on
generated module filenames with descriptor-based inspection of Protobuf-ES
generated module source, while continuing to fail closed for neutral or
unreadable generated modules.

## Scope

- Update the build-time handler analyzer only where it resolves generated
  imports and schema roles.
- Derive command/event role from the generated schema companion's Protobuf
  descriptor source file, such as descriptor file names ending in
  `commands.proto` or `events.proto`.
- Keep entity state schema inference working for neutral generated modules.
- Fail closed for handler signal/emitted roles when the generated descriptor is
  absent, malformed, neutral, or not tied to the imported schema export.
- Add focused analyzer tests proving:
  - neutral generated module path plus descriptor `*_commands.proto` is
    accepted as command;
  - neutral generated module path plus descriptor `*_events.proto` is accepted
    as event;
  - misleading module path such as `commands_pb` with neutral descriptor does
    not classify as command;
  - missing/malformed descriptor data fails closed with existing deterministic
    diagnostics;
  - state schemas from neutral modules still work.
- Do not change runtime ingestion, writer output shape, discovery, transport,
  metadata factories, app examples, public handler APIs, `@React` void
  behavior, or generated registry version unless a reviewer finds a direct
  contract mismatch.

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

- Analyzer no longer relies on module specifier basename regexes such as
  `commands_pb` or `events_pb` for command/event role decisions.
- Command/event roles are inferred from descriptor-backed `.proto` identity for
  the schema export being used.
- Neutral generated modules continue to produce `undefined` role and are
  rejected for handler signal/emitted command/event positions.
- Existing handler invariants hold: no framework envelopes in ordinary
  handlers, no `@Apply`, no schema-bearing decorators, no manual transactions,
  no app-owned materialization.
- No generated files are committed.
- Durable docs reflect that role discovery is descriptor-based, not
  generated-filename-based.

## Verification Plan

- Focused RED/GREEN:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/handler/build-time-handler-analyzer.test.ts`.
- `pnpm --config.verify-deps-before-run=false typecheck:build`.
- `pnpm --config.verify-deps-before-run=false docs:check`.
- `pnpm --config.verify-deps-before-run=false format:check`.
- `git diff --check`.
- Full `pnpm --config.verify-deps-before-run=false verify` before integration.
