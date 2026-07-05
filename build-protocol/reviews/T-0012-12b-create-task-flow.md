# Review Log: T-0012.12b Create Task Flow

Task log: `build-protocol/tasks/T-0012-12b-create-task-flow/TASK.md`
Branch: `task/T-0012-12b-create-task-flow`
Baseline commit: `775aa47`
Reviewed commit/diff basis: implementation commit `a784ea5`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12b-create-task-flow`
Status: round-one findings accepted; review-fix pass in progress

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Implementation Review Rounds

### Round 1 - `a784ea5`

| Lane                       | Agent                                  | Result   |
| -------------------------- | -------------------------------------- | -------- |
| code style/maintainability | `019f3284-1935-7723-b660-34a64c414c81` | Comments |
| documentation              | `019f3284-4b15-7d10-bd96-67eaf9f6d5f7` | Comments |
| TypeScript/API docs        | `019f3284-9782-7ea0-827a-06994628ea7c` | Comments |
| security                   | `019f3284-f9f5-7d42-ad92-c70e23cb4784` | Comments |
| performance/reliability    | `019f3285-56e3-7a03-9688-85aa4038539a` | Comments |

Findings:

- Public docs still described `AggregateStorage` as primitive-ID-only even
  after the task added message-valued ID support.
- Task and work logs still said the implementation commit and review state were
  pending.
- `AggregateId` accepted arbitrary Protobuf `Message` objects and keyed them by
  broad `JSON.stringify()`, which made IDs non-canonical and too broad for a
  public storage seam.
- Repository event routing unwrapped any object with a primitive `value`, which
  could collapse distinct message IDs and ignore extra fields.
- Example tests imported `examples/todo/dist` without making the build-output
  dependency explicit.
- `TaskListProjection` writes one row per task, so docs and tests needed to make
  that current behavior explicit instead of implying a singleton list.
- `pnpm docs:check` still emitted `@generated` TypeDoc tag warnings from
  generated comments.

Planned fixes:

- Restrict supported message aggregate IDs to the existing single-field
  generated ID shape: `$typeName` plus a finite primitive `value`.
- Preserve message identity in aggregate storage keys with `$typeName`,
  primitive kind, and primitive value.
- Use the same single-field message-ID reader for repository event routing.
- Add negative tests for non-finite numbers and extra-field message IDs.
- Make the focused example test assert fresh built output exists before dynamic
  import.
- Update public docs, example docs, task logs, and TypeDoc tag config before
  rerunning verification.
