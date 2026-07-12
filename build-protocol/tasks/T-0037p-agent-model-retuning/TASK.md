# T-0037p: Agent Model Retuning

Status: Implementation verified; targeted review pending

Started: `2026-07-12`

Baseline commit: `c1528f85`

Branch: `task/T-0037p-agent-model-retuning`

Worktree: `.worktrees/T-0037p-agent-model-retuning`

## Objective

Retune the existing autonomous multi-subagent protocol from uniform GPT-5.6 Sol
High to function-appropriate GPT-5.6 models and reasoning while preserving role
identity, responsibilities, quality gates, current work, and autonomous
continuation.

## Human-Imposed Requirements Ledger

- Preserve the existing orchestrator, requirements splitter, implementer, four
  specialist reviewers, and final security reviewer; do not invent, rename,
  merge, or replace roles.
- Future orchestrators use Sol Medium; selective architecture/planning uses Sol
  High; implementation/fixes use Terra Medium; correctness/high-risk review
  uses Terra High; mechanical evidence uses Luna Low/Medium; docs/dependency/API
  verification uses Luna Medium.
- Use Standard speed, not Fast/boost; do not use Max or Ultra normally.
- Configure at most four threads and one subagent depth.
- One production writer owns overlapping files; parallel work is genuinely
  independent; preserve user and dirty-worktree changes.
- Deep planning and Sol High are selective, not automatic.
- Mechanical failures return directly to implementation.
- Reviews are milestone-scoped and concern-specific; confirmed findings return
  to the existing implementation context when possible.
- Preserve all DDD, compatibility, public API, testing, documentation,
  verification, logging, and release gates.
- Update durable protocol/configuration first, then resume current T-0037b work
  without human confirmation.
- Never touch `human-review-1-jul.md`.

## Existing Role Classification

| Existing role                    | Regular function                                              | Allocation                                               |
| -------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| Main orchestrator                | Milestone framing, coordination, integration                  | Sol Medium; Sol High only for listed escalation triggers |
| Requirements splitter            | Architecture-significant decomposition and difficult planning | Sol High                                                 |
| Implementer                      | Production TypeScript and bounded fixes                       | Terra Medium                                             |
| Style/maintainability reviewer   | Correctness-aware maintainability review                      | Terra High                                               |
| Documentation reviewer           | Current docs/status/package verification                      | Luna Medium                                              |
| TypeScript/API-docs reviewer     | Public contract, compatibility, declaration review            | Terra High                                               |
| Performance/reliability reviewer | Concurrency, persistence, lifecycle, boundedness              | Terra High                                               |
| Security reviewer                | Final security/trust-boundary review                          | Terra High                                               |

The repository has no separate verifier role. Builds, tests, scanning, and log
triage remain orchestrator-dispatched functions using Luna Low/Medium.

## Skill Applicability

- Read `subagent-driven-development` for explicit model dispatch, bounded
  review packages, and context-efficient handoffs.
- Read `using-git-worktrees`; this task uses its own ignored project worktree.
- Read `requesting-code-review` and `verification-before-completion` for the
  review and evidence gates.
- Read `openai-docs` and attempted its Codex manual helper. The helper failed
  because the response lacked `x-content-sha256`; current local Codex CLI/config
  behavior and official OpenAI search were used as bounded schema evidence.
- Checked `build-protocol/skills/EXPECTED_SKILLS.md`. No project-owned skill
  definitions existed to retune; repository behavior was governed by the build
  protocol only.

## Acceptance

- Project `.codex/config.toml` defaults future sessions to Sol Medium, disables
  fast mode, and sets `max_threads = 4`, `max_depth = 1`.
- Every existing subagent role has one project-scoped model profile matching
  its real remit.
- Root `AGENTS.md`, build protocol, completion plan, and role profiles agree on
  selective planning, implementation, verification, review, fixes, escalation,
  concurrency, and autonomy.
- No instruction requires uniform Sol High or generic full-repository review
  after each small change.
- Codex strict configuration parsing, formatting, docs/status lint, and diff
  hygiene pass.
- The change is reviewed, integrated, and T-0037b resumes under the allocation.
