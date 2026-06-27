# Review Log: <TASK-ID> <Reviewer Role> Round <N>

Task log: `build-protocol/tasks/<task-slug>/TASK.md`
Branch: `<branch-name>`
Baseline commit: `<short-sha>`
Reviewed commit/diff basis: `<commit or git diff main...HEAD>`
Worktree: `<absolute-path>`
Reviewer role: code style/maintainability | documentation | TypeScript/API docs | security | performance/reliability
Reviewer sub-agent: `<agent-id>`
Review timestamp: `<YYYY-MM-DD HH:MM TZ>`
Status: Pending | Comments | No remaining comments

## Scope Reviewed

- Files reviewed: `<paths>`
- Dirty status/untracked files: `<git status --short --branch output or clean>`
- Protocol references: `build-protocol/BUILD_PROTOCOL.md`, `build-protocol/CODE_QUALITY.md`

## Evidence Checklist

For any N/A entry, explain why the evidence does not apply to the reviewed task. Do not leave generic placeholders in completed review logs.

| Evidence | Reviewed | Notes |
| --- | --- | --- |
| Skill applicability check | `<yes/no/N/A>` | `<skills checked; SKILL.md files read; skipped skills with reasons; or explicit N/A rationale>` |
| Committed diff basis (`git diff main...HEAD`) | `<yes/no/N/A>` | `<notes>` |
| Public export/API diff | `<yes/no/N/A>` | `<notes; if N/A, explain why no public export/API diff applies>` |
| TypeDoc/reference generation | `<yes/no/N/A>` | `<notes; if N/A, explain why TypeDoc/reference generation does not apply>` |
| Package README impact | `<yes/no/N/A>` | `<notes; if N/A, explain why no package README impact applies>` |
| Framework `USER_GUIDE.md` impact | `<yes/no/N/A>` | `<notes; if N/A, explain why no framework user-guide impact applies>` |
| Example `USER_GUIDE.md` impact | `<yes/no/N/A>` | `<notes; if N/A, explain why no example user-guide impact applies>` |
| API examples | `<yes/no/N/A>` | `<notes; if N/A, explain why no API example impact applies>` |
| Compatibility notes | `<yes/no/N/A>` | `<notes; if N/A, explain why no compatibility impact applies>` |
| Tests run | `<yes/no/N/A>` | `<notes>` |
| Coverage result or exception | `<yes/no/N/A>` | `<notes>` |

## Per-Role Coverage Notes

| Role | Applicable Areas | Not Applicable Areas | Notes |
| --- | --- | --- | --- |
| code style/maintainability | `<areas>` | `<areas>` | `<notes>` |
| documentation | `<areas>` | `<areas>` | `<notes>` |
| TypeScript/API docs | `<areas>` | `<areas>` | `<notes>` |
| security | Link/apply `build-protocol/CODE_QUALITY.md#security-standards`; state applicable areas such as dependencies, secrets, IPC, validation, tenant boundaries, `Any`/deserialization, and logging. | `<areas>` | `<notes>` |
| performance/reliability | `<areas>` | `<areas>` | `<notes>` |

## Findings

| Severity | File | Line/Section | Finding | Required Action |
| --- | --- | --- | --- | --- |
| `<P0-P3>` | `<path>` | `<line or section>` | `<issue>` | `<fix or exception needed>` |

## Author Response

- Pending.

## Verification Requested

- Pending.

## Outcome

Pending.
