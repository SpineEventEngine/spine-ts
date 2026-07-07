# T-0014 Guardrail Baseline And Red Tests

## Purpose

Create automated guardrails that fail on the public API violations called out by
the human before the runtime migration starts.

## Required Context

- Task log: `build-protocol/tasks/T-0014-end-user-api-invariants/TASK.md`
- Work log: `build-protocol/work-logs/T-0014.md`
- Review log: `build-protocol/reviews/T-0014-end-user-api-invariants.md`
- Existing guard: `scripts/check-cleanup-rules.mjs`
- Existing guard tests: `scripts/check-cleanup-rules.test.mjs`
- Current violating example: `examples/todo/src/index.ts`
- Spine JVM references:
  - `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`
  - `/private/tmp/spine-adr-0001-aggregates-without-event-sourcing.md`

## Binding Requirements

Extend the existing cleanup guard rather than adding a second scanner.

The guard must inspect end-user example source files under `examples/**/src`
and fail on:

- `@Apply`
- schema-bearing decorators: `@Assign(...)`, `@Command(...)`, `@React(...)`,
  and `@Subscribe(...)`
- `startTransaction`
- `commitTransaction`
- `packEvent`
- `packCommand`
- `EventIdSchema`
- handler return types `Event` or `Command`
- `materializeDecoratedEntityHandlers`
- command-handler first-field extraction like `requireTaskId(command.id)`

Add tests proving the new checks reject the patterns above and accept a minimal
example that uses bare decorators with generated-message return types.

Keep the implementation simple. Prefer one grouped checker object or a small
set of local functions inside `scripts/check-cleanup-rules.mjs`; do not create a
new package or a new scanner framework.

Update the T-0014 task/work/review logs with what changed and the verification
run.

## Verification

Run:

```sh
corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs
node scripts/check-cleanup-rules.mjs
```

The second command is expected to fail while `examples/todo/src/index.ts` still
contains the known violations. Record that as intentional RED evidence.

## Report Contract

Write a report to
`build-protocol/tasks/T-0014-end-user-api-invariants/guardrail-task-report.md`
with:

- status: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`
- files changed
- tests/commands run with pass/fail result
- any concerns

Return only a short status summary to the orchestrator.
