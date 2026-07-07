# T-0014 Guardrail Review Fix Brief

## Purpose

Fix the guardrail baseline findings from review round 1 without changing
runtime/framework behavior.

## Owned Files

- `scripts/check-cleanup-rules.mjs`
- `scripts/check-cleanup-rules.test.mjs`
- `build-protocol/tasks/T-0014-end-user-api-invariants/guardrail-task-report.md`
- `build-protocol/tasks/T-0014-end-user-api-invariants/TASK.md`
- `build-protocol/work-logs/T-0014.md`
- `build-protocol/reviews/T-0014-end-user-api-invariants.md`

## Required Fixes

1. Detect forbidden handler return types through obvious aliases and qualified
   names, not only literal `Event` and `Command`.
2. Detect schema-bearing decorators in direct, aliased import, and qualified
   forms such as `@Assign(Schema)`, `@LegacyAssign(Schema)`, and
   `@spine.Assign(Schema)`.
3. Detect manual command target-ID extraction more broadly than the exact
   `requireTaskId(command.id)` spelling. At minimum, catch helper calls wrapping
   `command.<field>` and assignment of `command.<field>` in methods decorated as
   command handlers.
4. Avoid reading tracked symlink targets outside the repository root when
   scanning example source files. Either reject such symlinks as guard
   violations or skip them with a clear cleanup failure; do not silently read the
   target.
5. Include `.tsx`, `.mts`, and `.cts` example source files in the example-source
   scan.

Keep the checker simple. Do not introduce TypeScript type-checker setup, module
resolution, new dependencies, or a new scanner framework.

## Required Tests

Extend `scripts/check-cleanup-rules.test.mjs` to cover:

- aliased `Event`/`Command` returns;
- qualified/schema-bearing decorators;
- aliased schema-bearing decorators imported from `@spine-ts/server`;
- manual command ID extraction variants such as `const id = command.target;` and
  `requireTarget(command.target)`;
- symlinked example source outside the repo root;
- `.tsx`, `.mts`, or `.cts` example source coverage.

## Verification

Run:

```sh
corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs
node scripts/check-cleanup-rules.mjs
```

The second command should still fail intentionally until the to-do example is
migrated, but it must not fail because the checker crashes.

## Report Contract

Append fix results to
`build-protocol/tasks/T-0014-end-user-api-invariants/guardrail-task-report.md`
with:

- status: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`
- files changed
- tests/commands run with pass/fail result
- remaining concerns

Return only short status, file list, command summary, and concerns.
