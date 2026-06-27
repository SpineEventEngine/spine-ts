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

Canonical checklist: record evidence for `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Skill sources checked:

| Source | Scope Checked | Evidence |
| --- | --- | --- |
| Session skill inventory | `<full session list, task-relevant subset, or unavailable>` | `<source or failure>` |
| Task-provided skill names/paths | `<checked paths/names or N/A>` | `<prompt/task source>` |
| `build-protocol/skills/EXPECTED_SKILLS.md` | `<checked or N/A>` | `<result>` |
| `~/.agents/skills/*/SKILL.md` | `<full directory, task-provided paths only, or unreachable>` | `<command/source/failure>` |
| `~/.agents/.skill-lock.json` or equivalent manifest | `<checked or unreachable>` | `<source repos/local relative paths/failure>` |

Selected skills read before task actions:

| Skill | Source | Applicability | Instructions Applied |
| --- | --- | --- | --- |
| `<skill name>` | `<session source, repo manifest entry, or redacted path such as ~/.agents/skills/<skill>/SKILL.md>` | `<why applicable>` | `<concise summary or file reference>` |

Skills passed to sub-agents/reviewers:

| Recipient | Skills/Instructions Passed | Notes |
| --- | --- | --- |
| `<agent or reviewer role>` | `<skill names and references>` | `<notes>` |

Skipped relevant-looking skills:

| Skill | Source | Reason Skipped |
| --- | --- | --- |
| `<skill name>` | `<metadata source or redacted path>` | `<specific reason; do not imply SKILL.md was fully read unless it was selected/read>` |

Conflict resolution: if an installed skill conflicts with `BUILD_PROTOCOL.md`,
`CODE_QUALITY.md`, the task specification, sandbox/approval rules, or explicit
human/orchestrator authorization, the project and authorization sources are
authoritative. Record the conflict and chosen rule in this task log.

Redaction: do not commit absolute user-level skill paths. Prefer
`~/.agents/skills/<skill>/SKILL.md`, `<user-skill-dir>/<skill>/SKILL.md`, or a
repo manifest reference.

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
