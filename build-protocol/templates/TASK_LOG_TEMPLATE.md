# <TASK-ID>: <Task Title>

Status: Draft | In progress | In review | Changes requested | Ready for review round <N> | Complete | Integrated | Blocked
Start: `<YYYY-MM-DD HH:MM TZ>`
End: Pending
Baseline commit: `<short-sha>`
Task log path: `build-protocol/tasks/<task-slug>/TASK.md`
Branch: `<branch-name>`
Worktree: `<absolute-path>`
Authoring sub-agent: `<agent-id and specialty>`
Reviewer sub-agents: Pending
Implementation commit: Pending branch commit
Final branch HEAD: Pending branch commit

## Objective

State the outcome this task must produce.

## Required Inputs Read

- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/CODE_QUALITY.md`
- `<task-specific input>`

## Skill Applicability

Installed skills checked:

- Built-in/session-available skills: `<checked source or N/A with reason>`.
- User-installed skills under `~/.agents/skills`: `<checked source or unreachable with reason>`.
- Task-provided skill paths or names: `<checked source or N/A with reason>`.

Skills read before task actions:

| Skill | Source | Applicability | Instructions Applied |
| --- | --- | --- | --- |
| `<skill name>` | `<path or session source>` | `<why applicable>` | `<concise summary or file reference>` |

Skills passed to sub-agents/reviewers:

| Recipient | Skills/Instructions Passed | Notes |
| --- | --- | --- |
| `<agent or reviewer role>` | `<skill names and references>` | `<notes>` |

Skipped relevant-looking skills:

| Skill | Source | Reason Skipped |
| --- | --- | --- |
| `<skill name>` | `<path or session source>` | `<specific reason>` |

Conflict resolution: if an installed skill conflicts with `BUILD_PROTOCOL.md`,
`CODE_QUALITY.md`, or the task specification, the project protocol, quality
rules, and task spec are authoritative. Record the conflict and chosen rule in
this task log.

## Scope

In scope:

- `<owned work>`

Out of scope:

- `<explicit non-goals>`

## Work Log

- `<timestamp>`: Created or updated this task log before or alongside changes.

## Decisions

- Link to `build-protocol/DECISION_LOG.md` entries or task-specific decision records.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none.

## Files Changed

- Pending.

## Tests Run

- `<command>` - `<result>`.
- If N/A, explain why and link the exception or decision.

## Coverage Result

- `<coverage result>`.
- If N/A, explain why coverage cannot be generated and identify the reviewer or decision that must accept the exception.

## Documentation And Public API Impact

| Area | Impact |
| --- | --- |
| Package README impact | `<impact or N/A with reason>` |
| TypeDoc/API docs impact | `<impact or N/A with reason>` |
| Public API additions/removals | `<impact or N/A with reason>` |
| Framework `USER_GUIDE.md` impact | `<impact or N/A with reason>` |
| Example `USER_GUIDE.md` impact | `<impact or N/A with reason>` |
| API examples | `<impact or N/A with reason>` |
| Compatibility notes | `<impact or N/A with reason>` |

## Security Impact

| Area | Impact |
| --- | --- |
| Dependencies | `<impact or N/A with reason>` |
| Secrets and credentials | `<impact or N/A with reason>` |
| IPC | `<impact or N/A with reason>` |
| Validation | `<impact or N/A with reason>` |
| Tenant boundaries | `<impact or N/A with reason>` |
| `Any`/deserialization | `<impact or N/A with reason>` |
| Logging | `<impact or N/A with reason>` |

Redaction rule: record enough context for auditability, but never commit tokens, credentials, auth headers, secret environment variables, sensitive local paths, or sensitive payloads.

## Verification

- Pending.
- Include committed-diff verification such as `git diff --check main...HEAD` after staging and commit.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up | Owner | Linked Task/Decision | Disposition | Next Review Point |
| --- | --- | --- | --- | --- |
| `<risk or deferral>` | `<owner>` | `<task or decision>` | `<accepted, deferred, N/A, blocked>` | `<review point>` |

## Review Rounds

- Pending.

## Integration Result

Pending.
