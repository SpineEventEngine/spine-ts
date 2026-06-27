# T-0003: Installed Skill Use Protocol

Status: Ready for review round 1
Start: `2026-06-27 18:10 WEST`
End: `2026-06-27 18:26 WEST`
Baseline commit: `0566998`
Task log path: `build-protocol/tasks/T-0003-skill-use-protocol/TASK.md`
Branch: `task/T-0003-skill-use-protocol`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0003-skill-use-protocol`
Authoring sub-agent: Codex implementation sub-agent, senior agentic-workflow engineer
Reviewer sub-agents: Pending
Implementation commit: Branch commit created after this log update; see final handoff.
Final branch HEAD: Branch commit created after this log update; see final handoff.

## Objective

Make installed skills an explicit, auditable part of autonomous agentic work so future orchestrators, implementers, advisers, and reviewers use relevant skills where needed instead of relying on memory.

## Required Inputs Read

- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/CONTRIBUTOR_WORKFLOW.md`
- `build-protocol/templates/TASK_LOG_TEMPLATE.md`
- `build-protocol/templates/REVIEW_LOG_TEMPLATE.md`
- `build-protocol/tasks/T-0003-skill-use-protocol/TASK.md`
- `build-protocol/work-logs/T-0003.md`
- `build-protocol/CODE_QUALITY.md`
- Installed skills:
  - `/Users/armiol/.agents/skills/subagent-driven-development/SKILL.md`
  - `/Users/armiol/.agents/skills/using-git-worktrees/SKILL.md`
  - `/Users/armiol/.agents/skills/requesting-code-review/SKILL.md`
  - `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md`
  - `/Users/armiol/.agents/skills/planning-with-files/SKILL.md`
  - `/Users/armiol/.agents/skills/architecture-decision-records/SKILL.md`
  - `/Users/armiol/.agents/skills/typescript-advanced-types/SKILL.md`
  - `/Users/armiol/.agents/skills/nodejs-backend-patterns/SKILL.md`

## Skill Applicability

Installed skills checked:

- Built-in/session-available skills: checked from the session skill list.
- User-installed skills under `~/.agents/skills`: checked for the task-provided installed skill paths.
- Task-provided skill paths or names: checked from the orchestrator instructions for T-0003.

Skills read before task actions:

| Skill | Source | Applicability | Instructions Applied |
| --- | --- | --- | --- |
| `subagent-driven-development` | `/Users/armiol/.agents/skills/subagent-driven-development/SKILL.md` | Applicable to future orchestrator/sub-agent protocol. | Require precise sub-agent prompts, reviewer handoffs, durable progress, and review loops. |
| `using-git-worktrees` | `/Users/armiol/.agents/skills/using-git-worktrees/SKILL.md` | Applicable to isolated task work. | Confirmed this session is already in the assigned linked worktree; no new worktree created. |
| `requesting-code-review` | `/Users/armiol/.agents/skills/requesting-code-review/SKILL.md` | Applicable to review-ready handoff. | Reinforced review-before-merge and reviewer context requirements. |
| `verification-before-completion` | `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md` | Applicable before any completion claim or commit. | Verification results must be fresh and recorded before ready-for-review status. |
| `planning-with-files` | `/Users/armiol/.agents/skills/planning-with-files/SKILL.md` | Applicable to durable multi-step planning. | Used existing task/work logs as persistent planning records; no extra plan files needed for this scoped governance task. |
| `architecture-decision-records` | `/Users/armiol/.agents/skills/architecture-decision-records/SKILL.md` | Applicable because T-0003 creates a durable governance decision. | Added a concise `DECISION_LOG.md` entry rather than a separate ADR directory. |
| `typescript-advanced-types` | `/Users/armiol/.agents/skills/typescript-advanced-types/SKILL.md` | Relevant-looking to the repository domain but not to this docs-only governance edit. | Read for applicability; no TypeScript type guidance applied because no runtime code changed. |
| `nodejs-backend-patterns` | `/Users/armiol/.agents/skills/nodejs-backend-patterns/SKILL.md` | Relevant-looking to future backend tasks but not to this docs-only governance edit. | Read for applicability; no backend implementation guidance applied because no runtime code changed. |

Skills passed to sub-agents/reviewers:

| Recipient | Skills/Instructions Passed | Notes |
| --- | --- | --- |
| Future implementers, advisers, and reviewers through protocol/templates | Skill applicability gate; read relevant `SKILL.md`; pass concise task-relevant instructions; record use/skip/conflicts. | Added to `BUILD_PROTOCOL.md`, `CONTRIBUTOR_WORKFLOW.md`, and task/review templates. |
| T-0003 reviewers | Applicable skills and skip decisions are recorded in this task log. | Reviewers should verify the new review template evidence row and this log's skill evidence. |

Skipped relevant-looking skills:

| Skill | Source | Reason Skipped |
| --- | --- | --- |
| `typescript-advanced-types` | `/Users/armiol/.agents/skills/typescript-advanced-types/SKILL.md` | Not task-applicable because T-0003 changes governance docs only and no TypeScript code or public API types. |
| `nodejs-backend-patterns` | `/Users/armiol/.agents/skills/nodejs-backend-patterns/SKILL.md` | Not task-applicable because T-0003 changes governance docs only and no Node backend runtime. |

Conflict resolution: no direct skill conflict required an exception. The new
policy records that `BUILD_PROTOCOL.md`, `CODE_QUALITY.md`, and the task spec
override installed skills when conflicts exist.

## Scope

In scope:

- Add a durable skill-applicability gate to build protocol and contributor workflow.
- Add task-template fields for applicable skills, read skills, skipped skills, and skill-driven instructions given to sub-agents.
- Record the installed skills source and the Node/tooling fix that enabled installation.
- Leave any T-0002 resumption or messaging to the orchestrator after T-0003 integrates.

Out of scope:

- Changing the installed skill contents.
- Installing additional skills.
- Replacing the existing build protocol with any single installed skill.
- Resuming T-0002 before this task is integrated.

## Work Log

- `2026-06-27 18:10 WEST`: Main orchestrator created task branch/worktree and initial task/work logs.
- `2026-06-27 18:10 WEST`: Main orchestrator read process-critical installed skills before authoring instructions.
- `2026-06-27 18:21 WEST`: Authoring sub-agent read required protocol docs, task logs, `CODE_QUALITY.md`, and installed skill instructions before edits.
- `2026-06-27 18:21 WEST`: Authoring sub-agent confirmed existing linked worktree isolation and began docs-only governance edits.
- `2026-06-27 18:26 WEST`: Authoring sub-agent ran verification, updated logs, and prepared branch for review round 1.

## Decisions

- `build-protocol/DECISION_LOG.md#d-0019-user-installed-skills-are-governed-inputs-not-optional-memory`

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none.

## Files Changed

- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/CONTRIBUTOR_WORKFLOW.md`
- `build-protocol/DECISION_LOG.md`
- `build-protocol/templates/TASK_LOG_TEMPLATE.md`
- `build-protocol/templates/REVIEW_LOG_TEMPLATE.md`
- `build-protocol/work-logs/T-0003.md`
- `build-protocol/tasks/T-0003-skill-use-protocol/TASK.md`

## Tests Run

- `git diff --check` - passed; no whitespace errors.
- Stale-placeholder wording search over changed non-template governance files - passed after log update; no stale vague wording in task-specific/protocol decision files.
- `git status --short --porcelain=v1` - passed; changed paths are under `build-protocol/`.
- `git diff --name-only` plus untracked-file check - passed; no runtime/toolchain package files were added.

## Coverage Result

- N/A: docs-only governance task with no runtime code or testable TypeScript surface. Must be accepted by reviewers.

## Documentation And Public API Impact

| Area | Impact |
| --- | --- |
| Package README impact | N/A: no package behavior changes. |
| TypeDoc/API docs impact | N/A: no TypeScript API changes. |
| Public API additions/removals | N/A: no public code API changes. |
| Framework `USER_GUIDE.md` impact | N/A: governance-only process change. |
| Example `USER_GUIDE.md` impact | N/A: example app untouched. |
| API examples | N/A: no API behavior. |
| Compatibility notes | N/A: no Spine compatibility behavior. |

## Security Impact

| Area | Impact |
| --- | --- |
| Dependencies | N/A: no package dependencies. |
| Secrets and credentials | N/A: no secrets. |
| IPC | N/A: no IPC behavior. |
| Validation | N/A: no validation behavior. |
| Tenant boundaries | N/A: no runtime behavior. |
| `Any`/deserialization | N/A: no Protobuf behavior. |
| Logging | Process logs mention installed skill names only; no sensitive paths beyond already local user-level skill locations. |

Redaction rule: record enough context for auditability, but never commit tokens, credentials, auth headers, secret environment variables, sensitive local paths, or sensitive payloads.

## Verification

- Pre-commit verification passed with the commands in Tests Run.
- Post-commit verification must include `git diff --check main...HEAD`.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up | Owner | Linked Task/Decision | Disposition | Next Review Point |
| --- | --- | --- | --- | --- |
| Installed skills live outside the repository and may not appear in a compacted skill list until the next session. | Main orchestrator | T-0003 | Accepted; protocol checks reachable installed skills and records unreachable sources. | T-0003 review round 1 |
| Over-broad skills could conflict with the build protocol if used blindly. | Main orchestrator | D-0019 | Accepted; project protocol, quality rules, and task spec override installed skills. | T-0003 review round 1 |

## Review Rounds

- Ready for review round 1.

## Integration Result

Pending.
