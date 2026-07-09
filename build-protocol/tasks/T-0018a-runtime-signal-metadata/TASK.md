# T-0018a: Runtime Signal Metadata Factories

Status: complete on task branch
Started: `2026-07-09`
Branch: `task/T-0018a-runtime-signal-metadata`
Worktree:
`.worktrees/T-0018a-runtime-signal-metadata`
Base commit: `a8f0e42`

## Objective

Add a small framework-owned runtime metadata factory slice for generated Spine
signal metadata: IDs, timestamps, actor/tenant command context, event origin,
producer ID, and version metadata.

## Scope

- Inspect the relevant Spine JVM docs and source areas before implementation.
- Add narrow TypeScript APIs for deterministic runtime metadata generation.
- Keep low-level `packCommand()` and `packEvent()` available for framework and
  advanced callers.
- Preserve end-user handler invariants: handlers return generated domain
  messages, not framework `Event` envelopes; no `@Apply`; no manual end-user
  transactions; no application-owned handler materialization.
- Prefer small OOP-style objects/classes over scattered utility functions.
- Do not add production storage, tracing, health, auth, or multi-host transport
  features in this slice.

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

## Acceptance Criteria

- Runtime metadata factories can create command IDs, event IDs, timestamps,
  actor contexts, command contexts, origins, producer IDs, and versions through
  one shared policy surface.
- Factories support deterministic IDs and time for tests without process-wide
  mutable globals.
- Repository-produced events/commands can use the shared policy where this
  slice touches their metadata.
- Event contexts carry timestamp, origin, producer, and version consistently in
  the supported local runtime paths.
- Routine tests/example paths can adopt command context construction without
  hand-rolling ordinary actor/tenant metadata in this slice or the follow-up
  adoption task.
- Documentation and API docs describe the supported local runtime metadata
  seam and keep broader production gaps honest.
- Focused runtime/repository tests, typecheck, docs check, format check, and
  `git diff --check` pass; full `verify` must pass before integration or a real
  blocker must be recorded.

## Verification Plan

- Focused metadata factory tests.
- Focused repository/runtime tests covering produced event metadata.
- `pnpm --config.verify-deps-before-run=false typecheck:generated`.
- `pnpm --config.verify-deps-before-run=false lint:generated`.
- `pnpm --config.verify-deps-before-run=false docs:check:generated`.
- `pnpm --config.verify-deps-before-run=false format:check`.
- `git diff --check`.
- Full `pnpm --config.verify-deps-before-run=false verify` before integration.
