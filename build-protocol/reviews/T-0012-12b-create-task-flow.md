# Review Log: T-0012.12b Create Task Flow

Task log: `build-protocol/tasks/T-0012-12b-create-task-flow/TASK.md`
Branch: `task/T-0012-12b-create-task-flow`
Baseline commit: `775aa47`
Reviewed commit/diff basis: implementation commit `a784ea5`; review-fix commit
`2753627`; second-fix commit `61acd94`; third-fix commit `1dd62c8`;
round-four-fix commit `afe5162`; round-five-doc-fix commit `e95cd02`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12b-create-task-flow`
Status: complete; final review round clean

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

- Public docs needed to describe complete generated message IDs consistently.
- Task and work logs still said the implementation commit and review state were
  pending.
- `AggregateId` accepted arbitrary Protobuf `Message` objects and keyed them by
  broad `JSON.stringify()`, which made IDs non-canonical and too broad for a
  public storage seam.
- Repository event routing needed to validate IDs against the Entity state
  schema and preserve complete generated message IDs.
- Example tests imported `examples/todo/dist` without making the build-output
  dependency explicit.
- `TaskListProjection` writes one row per task, so docs and tests needed to make
  that current behavior explicit instead of implying a singleton list.
- `pnpm docs:check` still emitted `@generated` TypeDoc tag warnings from
  generated comments.

Planned fixes:

- Accept supported primitive IDs and complete generated message IDs.
- Preserve descriptor-typed message identity in aggregate storage keys.
- Use the Entity state ID schema for repository Event routing.
- Add negative tests for non-finite primitive IDs and wrong message types.
- Make the focused example test assert fresh built output exists before dynamic
  import.
- Update public docs, example docs, task logs, and TypeDoc tag config before
  rerunning verification.

### Round 2 - `2753627`

| Lane                       | Agent                                  | Result   |
| -------------------------- | -------------------------------------- | -------- |
| code style/maintainability | `019f3299-a843-7530-9d40-3902bb0fbf06` | Clean    |
| documentation              | `019f3299-ca7f-7242-9faf-f67dc3ecee52` | Comments |
| TypeScript/API docs        | `019f3299-ed7c-7161-88b5-21c19f873ca8` | Comments |
| security                   | `019f329a-0d56-7bf2-a117-5f4675b8f7cc` | Comments |
| performance/reliability    | `019f329a-2e46-7fe3-b283-d66846fee948` | Clean    |

Findings:

- Documentation: task, implementation, review, and work logs still described
  the committed `2753627` review-fix pass as in progress.
- TypeScript/API: repository Event routes needed to return the complete ID type
  declared by the Entity state schema.
- TypeScript/API: exported `AggregateId` referenced `PrimitiveId` and
  `MessageId`, but those constituent types were not package-root exports.
- Security: snapshot writes persisted the caller-provided aggregate ID object
  after validation instead of the normalized ID, leaving hostile serialization
  hooks reachable during snapshot record JSON encoding.
- Security: repository event routing accepted non-finite numeric IDs through
  producer IDs or first-field route IDs.

Planned fixes:

- Normalize snapshot aggregate IDs before writing snapshot records.
- Normalize repository command/event IDs against the repository state's ID field:
  scalar-ID repositories receive finite primitive IDs, while message-ID
  repositories receive validated complete generated message IDs.
- Reject non-finite producer IDs and first-field route IDs.
- Export `PrimitiveId` and `MessageId` from `@spine-ts/server` and update the
  API export guard.
- Refresh durable task/review/work logs after the second fix pass.

### Round 3 - `61acd94` and `74b03ca`

| Lane                       | Agent                                  | Result   |
| -------------------------- | -------------------------------------- | -------- |
| code style/maintainability | `019f32a9-710c-7f02-a627-ce158977d2bf` | Comments |
| documentation              | `019f32a9-995c-72d3-b3b3-393f265c0e1c` | Clean    |
| TypeScript/API docs        | `019f32a9-be0a-7e82-87ad-cf87a90ad54b` | Clean    |
| security                   | `019f32a9-e378-7342-a248-ca706871772c` | Comments |
| performance/reliability    | `019f32aa-07ca-7831-bdf5-2fefb0f2ddc9` | Comments |

Findings:

- Security: tests covered non-finite producer IDs but not non-finite first-field
  IDs.
- Maintainability: server repository tests imported ignored generated example
  files from `examples/todo/generated`.
- Maintainability: `readEventFieldId()` was a one-use wrapper around route ID
  normalization.
- Maintainability: route errors needed to describe the target ID type precisely.
- Reliability: message-target route normalization needed to require the
  generated type declared by the repository state ID field.

Planned fixes:

- Add local test descriptors for message-ID and non-finite route scenarios.
- Reject message IDs whose `$typeName` differs from the repository state's ID
  field message type.
- Add regression coverage for wrong message-ID type and non-finite first-field
  route IDs.
- Inline the one-use event route ID wrapper and use target-specific error
  messages.

### Round 4 - `1dd62c8` and `9aa525b`

| Lane                       | Agent                                  | Result   |
| -------------------------- | -------------------------------------- | -------- |
| code style/maintainability | `019f32b6-b824-7c62-99be-455cee2c04c4` | Comments |
| documentation              | `019f32b6-b8d0-7303-a1e8-492a4125c18d` | Comments |
| TypeScript/API docs        | `019f32b6-b961-7431-93c1-1d9a5dd1d49f` | Comments |
| security                   | `019f32b6-ba06-7002-84a9-a8a3666e094b` | Clean    |
| performance/reliability    | `019f32b6-ba8f-7913-9ad0-4ab05f2f7e4e` | Clean    |

Findings:

- Maintainability: `targetMessageTypeName()` is a one-use helper around a
  simple descriptor branch.
- Documentation: the task header still said only round-one reviewers were
  closed.
- TypeScript/API: local descriptor fixtures used raw `label: 1` values instead
  of the generated `FieldDescriptorProto_Label.OPTIONAL` enum.

Planned fixes:

- Inline the target message type branch inside `readRouteId()`.
- Update the task header reviewer status for all completed rounds.
- Use the generated descriptor label enum in local route test descriptors.

### Round 5 - `afe5162` and `db7c14d`

| Lane                       | Agent                                  | Result   |
| -------------------------- | -------------------------------------- | -------- |
| code style/maintainability | `019f32bd-2b83-7403-bd37-72b844bbb63c` | Clean    |
| documentation              | `019f32bd-2c04-7aa2-9ff6-e6c8354af414` | Comments |
| TypeScript/API docs        | `019f32bd-2ca9-70c2-a1af-37fa90f5770f` | Clean    |
| security                   | `019f32bd-2d46-7762-82c6-6e17b7da4c48` | Clean    |
| performance/reliability    | `019f32bd-2e10-7a03-aaa5-86e617da36ce` | Clean    |

Findings:

- Documentation: the task header still said the round-four fix was pending
  after it had already been committed.

Planned fix:

- Update the task header reviewer status to reflect the completed fifth review
  round and the pending documentation-only fix.

### Round 6 - `e95cd02`

| Lane                       | Agent                                  | Result   |
| -------------------------- | -------------------------------------- | -------- |
| code style/maintainability | `019f32bf-8ea6-7af2-a527-313f7ea38eb7` | Comments |
| documentation              | `019f32bf-8f1e-7ad2-b588-1ba03118ee72` | Comments |
| TypeScript/API docs        | `019f32bf-8f8a-72a2-b58d-29dd7bbeddbb` | Clean    |
| security                   | `019f32bf-905d-7672-964a-e76d0bb3e0fa` | Clean    |
| performance/reliability    | `019f32bf-90e0-7453-aef2-415c011fe0cf` | Comments |

Findings:

- Maintainability, documentation, and reliability: task, review, and work-log
  status fields still described the pre-`e95cd02` state.

Planned fix:

- Record `e95cd02` as the round-five doc-fix commit and update task, review,
  and work-log status fields to the post-status-fix final re-review state.

### Round 7 - `0c25fce`

| Lane                       | Agent                                  | Result |
| -------------------------- | -------------------------------------- | ------ |
| code style/maintainability | `019f32c2-4791-7702-b51f-861901eb25c8` | Clean  |
| documentation              | `019f32c2-4814-7d41-8bf4-c78ce6384b04` | Clean  |
| TypeScript/API docs        | `019f32c2-4886-7573-a1c3-e8ff2e5861b5` | Clean  |
| security                   | `019f32c2-491d-7622-8b9c-d31b5c9c4f58` | Clean  |
| performance/reliability    | `019f32c2-49dc-7930-84a5-5e99b86b4a42` | Clean  |

Result: all required review lanes reported no remaining comments and were
closed.
