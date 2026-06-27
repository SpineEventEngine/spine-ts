# T-0003: Installed Skill Use Protocol

Status: Ready for review round 5
Start: `2026-06-27 18:10 WEST`
End: Pending
Baseline commit: `0566998`
Task log path: `build-protocol/tasks/T-0003-skill-use-protocol/TASK.md`
Branch: `task/T-0003-skill-use-protocol`
Worktree: `.worktrees/T-0003-skill-use-protocol`
Authoring sub-agent: Codex implementation sub-agent, senior agentic-workflow engineer
Reviewer sub-agents: Consolidated review rounds 1 through 5
Implementation commit: `be866f5`
Reviewed HEAD: `7826e7c`
Round 2 cleanup commit: `bba4ade`
Round 2 verification log commit: `40fe4af`
Round 3 cleanup commit: `3fbc304`
Round 3 verification log commit: `6cd258a`
Round 4 recovery-state commit: `57454a2`
Round 5 pending-state/skill-evidence commit: `53972f0`
Round 5 history-extension commit: `7826e7c`
Final branch HEAD: Current recovery basis is the actual branch tip; recover by
running `git rev-parse --short HEAD` and the current-tip verification commands
recorded below.

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
  - `~/.agents/skills/subagent-driven-development/SKILL.md`
  - `~/.agents/skills/using-git-worktrees/SKILL.md`
  - `~/.agents/skills/requesting-code-review/SKILL.md`
  - `~/.agents/skills/verification-before-completion/SKILL.md`
  - `~/.agents/skills/planning-with-files/SKILL.md`
  - `~/.agents/skills/architecture-decision-records/SKILL.md`
  - `~/.agents/skills/typescript-advanced-types/SKILL.md`
  - `~/.agents/skills/nodejs-backend-patterns/SKILL.md`
  - `~/.agents/skills/receiving-code-review/SKILL.md`

## Skill Applicability

Canonical checklist evidence:

| Source | Scope Checked | Evidence |
| --- | --- | --- |
| Session skill inventory | Bounded task-relevant subset from session-provided skills. | T-0003 prompt named eight installed skills; round 2 additionally used `receiving-code-review` and `verification-before-completion`; full inventory dump not required. |
| Task-provided skill names/paths | Checked task-provided names/paths. | Orchestrator instructions for T-0003. |
| `build-protocol/skills/EXPECTED_SKILLS.md` | Added and checked. | Manifest lists expected installed skills and source repos. |
| `~/.agents/skills/*/SKILL.md` | Full user skill directory entrypoint enumeration checked in round 2. | `find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md -print` listed available user-installed skill entrypoints. |
| `~/.agents/.skill-lock.json` | Checked expected skill source repos and local relative paths. | Local lock manifest identified `obra/superpowers`, `othmanadi/planning-with-files`, and `wshobson/agents` sources. |

Selected skills applied before task actions:

| Skill | Source | Applicability | Instructions Applied |
| --- | --- | --- | --- |
| `subagent-driven-development` | `~/.agents/skills/subagent-driven-development/SKILL.md` | Applicable to future orchestrator/sub-agent protocol. | Require precise sub-agent prompts, reviewer handoffs, durable progress, and review loops. |
| `using-git-worktrees` | `~/.agents/skills/using-git-worktrees/SKILL.md` | Applicable to isolated task work. | Confirmed this session is already in the assigned linked worktree; no new worktree created. |
| `requesting-code-review` | `~/.agents/skills/requesting-code-review/SKILL.md` | Applicable to review-ready handoff. | Reinforced review-before-merge and reviewer context requirements. |
| `verification-before-completion` | `~/.agents/skills/verification-before-completion/SKILL.md` | Applicable before any completion claim or commit. | Verification results must be fresh and recorded before ready-for-review status. |
| `planning-with-files` | `~/.agents/skills/planning-with-files/SKILL.md` | Applicable to durable multi-step planning. | Used existing task/work logs as persistent planning records; no extra plan files needed for this scoped governance task. |
| `architecture-decision-records` | `~/.agents/skills/architecture-decision-records/SKILL.md` | Applicable because T-0003 creates a durable governance decision. | Added and revised a concise `DECISION_LOG.md` entry rather than a separate ADR directory. |
| `receiving-code-review` | `~/.agents/skills/receiving-code-review/SKILL.md` | Applicable to round 1 feedback handling. | Evaluated comments against codebase state before cleanup edits. |

Skills passed to sub-agents/reviewers:

| Recipient | Skills/Instructions Passed | Notes |
| --- | --- | --- |
| Future implementers, advisers, and reviewers through protocol/templates | Skill applicability gate; read relevant `SKILL.md`; pass concise task-relevant instructions; record use/skip/conflicts. | Added to `BUILD_PROTOCOL.md`, `CONTRIBUTOR_WORKFLOW.md`, and task/review templates. |
| T-0003 reviewers | Applicable skills and skip decisions are recorded in this task log. | Reviewers should verify the new review template evidence row and this log's skill evidence. |

Skipped relevant-looking skills:

| Skill | Source | Reason Skipped |
| --- | --- | --- |
| `typescript-advanced-types` | Session inventory and `~/.agents/.skill-lock.json` metadata. | Triaged as repository-domain relevant but not selected for application because T-0003 changes governance docs only and no TypeScript code or public API types. |
| `nodejs-backend-patterns` | Session inventory and `~/.agents/.skill-lock.json` metadata. | Triaged as future-backend relevant but not selected for application because T-0003 changes governance docs only and no Node backend runtime. |

Conflict resolution: no direct skill conflict required an exception. The new
policy records that `BUILD_PROTOCOL.md`, `CODE_QUALITY.md`, task scope,
sandbox/approval rules, and explicit human/orchestrator authorization override
installed skills when conflicts exist.

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
- `2026-06-27 18:32 WEST`: Authoring sub-agent recorded review round 1 feedback, reviewed HEAD `be866f5`, and post-commit verification for `be866f5` before cleanup edits.
- `2026-06-27 18:37 WEST`: Authoring sub-agent ran current-tip cleanup verification, updated logs, and prepared branch for review round 2.
- `2026-06-27 18:39 WEST`: Authoring sub-agent recorded post-commit verification for cleanup commit `bba4ade`.
- `2026-06-27 18:44 WEST`: Authoring sub-agent recorded review round 2 findings, reviewed HEAD `40fe4af`, and current-tip verification for `40fe4af` before cleanup edits.
- `2026-06-27 18:45 WEST`: Authoring sub-agent recorded post-commit verification for round 3 cleanup commit `3fbc304`.
- `2026-06-27 18:50 WEST`: Authoring sub-agent recorded review round 3 finding, reviewed HEAD `6cd258a`, and current-tip verification for `6cd258a` before log-state successor cleanup.
- `2026-06-27 19:04 WEST`: Authoring sub-agent addressed round 4 findings for recovery-safe current state, pending task end state, and bounded skill inventory evidence.
- `2026-06-27 19:15 WEST`: Authoring sub-agent addressed final metadata/state findings for D-0019 bounded inventory wording and T-0003 recovery metadata.

## Decisions

- `build-protocol/DECISION_LOG.md#d-0019-user-installed-skills-are-governed-inputs-not-optional-memory`

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none.

## Files Changed

- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/CONTRIBUTOR_WORKFLOW.md`
- `build-protocol/DECISION_LOG.md`
- `build-protocol/skills/EXPECTED_SKILLS.md`
- `build-protocol/templates/TASK_LOG_TEMPLATE.md`
- `build-protocol/templates/REVIEW_LOG_TEMPLATE.md`
- `build-protocol/work-logs/T-0003.md`
- `build-protocol/tasks/T-0003-skill-use-protocol/TASK.md`

## Tests Run

- `git diff --check` - passed; no whitespace errors.
- Stale-placeholder wording search over changed non-template governance files - passed after log update; no stale vague wording in task-specific/protocol decision files.
- `git status --short --porcelain=v1` - passed; changed paths are under `build-protocol/`.
- `git diff --name-only` plus untracked-file check - passed; no runtime/toolchain package files were added.
- `git diff --check main...HEAD` at `be866f5` - passed post-commit.
- `git diff --name-status main...HEAD` at `be866f5` - only `build-protocol` files changed.
- `git diff --check main...HEAD` after round 1 cleanup edits - passed.
- `git diff --name-status main...HEAD` plus untracked-file check after cleanup edits - only `build-protocol` files changed or were newly added.
- No runtime/toolchain-file scan after cleanup edits - passed; no changed or untracked runtime/toolchain package paths matched.
- `git diff --check main...HEAD` at cleanup commit `bba4ade` - passed post-commit.
- `git diff --name-status main...HEAD` at cleanup commit `bba4ade` - only `build-protocol` files changed.
- Runtime/toolchain-file scan at cleanup commit `bba4ade` - passed; no runtime/toolchain package paths matched.
- Clean status at reviewed HEAD `40fe4af` - passed; worktree was clean.
- `git diff --check main...40fe4af` - passed.
- `git diff --name-status main...40fe4af` - only `build-protocol` files changed.
- Runtime/toolchain-file scan at reviewed HEAD `40fe4af` - passed; no runtime/toolchain package paths matched.
- `git diff --check main...HEAD` at round 3 cleanup commit `3fbc304` - passed.
- `git diff --name-status main...HEAD` at round 3 cleanup commit `3fbc304` - only `build-protocol` files changed.
- Runtime/toolchain-file scan at round 3 cleanup commit `3fbc304` - passed; no runtime/toolchain package paths matched.
- Clean status at round 3 cleanup commit `3fbc304` - passed; worktree was clean.
- Clean status at reviewed HEAD `6cd258a` - passed; worktree was clean.
- `git diff --check main...6cd258a` - passed.
- `git diff --name-status main...6cd258a` - only `build-protocol` files changed.
- Runtime/toolchain-file scan at reviewed HEAD `6cd258a` - passed; no runtime/toolchain package paths matched.

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
| Logging | Process logs mention installed skill names, redacted `~/.agents` paths, and normalized worktree paths only. |

Redaction rule: record enough context for auditability, but never commit tokens, credentials, auth headers, secret environment variables, sensitive local paths, or sensitive payloads.

## Verification

- Pre-commit verification passed with the commands in Tests Run.
- Post-commit verification for reviewed HEAD `be866f5` passed with `git diff --check main...HEAD`.
- Current-tip verification convention for round 2: verify `main...HEAD` with
  `git diff --check`, changed-file scope, and no runtime/toolchain-file scan.
  These checks passed before cleanup commit `bba4ade` and again after
  `bba4ade`.
- Current-tip verification for reviewed HEAD `40fe4af` passed with clean status,
  `git diff --check main...40fe4af`, docs-only changed paths under
  `build-protocol`, and no runtime/toolchain-file matches.
- Round 3 cleanup verification uses the same current-tip convention against the
  cleanup commit before review round 3 handoff.
- Round 3 cleanup commit `3fbc304` passed clean status,
  `git diff --check main...HEAD`, docs-only changed paths under
  `build-protocol`, and no runtime/toolchain-file matches.
- Current-tip verification for reviewed HEAD `6cd258a` passed with clean status,
  `git diff --check main...6cd258a`, docs-only changed paths under
  `build-protocol`, and no runtime/toolchain-file matches.
- Recovery convention: use the actual branch tip from
  `git rev-parse --short HEAD` as the current recovery basis, then rerun
  `git diff --check main...HEAD`, `git diff --name-status main...HEAD`, and the
  runtime/toolchain-file scan.
- Round 4 log-state cleanup commit `57454a2` passed clean status,
  `git diff --check main...HEAD`, and stale successor wording search.
- Round 5 pending-state and bounded skill evidence cleanup commit `53972f0`
  passed clean status, `git diff --check main...HEAD`, stale end-date search,
  and bounded skill evidence consistency search.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up | Owner | Linked Task/Decision | Disposition | Next Review Point |
| --- | --- | --- | --- | --- |
| Installed skills live outside the repository and may not appear in a compacted skill list until the next session. | Main orchestrator | T-0003 | Accepted; protocol checks reachable installed skills and records unreachable sources. | T-0003 review round 1 |
| Over-broad skills could conflict with the build protocol if used blindly. | Main orchestrator | D-0019 | Accepted; project protocol, quality rules, and task spec override installed skills. | T-0003 review round 1 |

## Review Rounds

- Round 1 at `be866f5`: comments addressed in round 2 cleanup.
- Round 2: ready after cleanup verification, cleanup commit, and verification log update.
- Round 2 at `40fe4af`: narrow findings received; cleanup prepared for review round 3.
- Round 3: ready after path-normalization cleanup and `3fbc304` verification.
- Round 3 at `6cd258a`: durable-state finding addressed; ready for review round 4.
- Round 4 at `57454a2`: recovery-state finding addressed; ready for final review.
- Final review at `53972f0`: pending end-state and bounded skill evidence findings addressed; ready for review round 5.
- Round 5 at `7826e7c`: review history extended through round-5 handoff; final metadata/state cleanup prepared.

## Integration Result

Not integrated.
