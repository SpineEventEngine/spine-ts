# Expected Installed Skills

Navigation: [Build Protocol](../BUILD_PROTOCOL.md) | Related: [Contributor Workflow](../CONTRIBUTOR_WORKFLOW.md)

This manifest records user-installed skills expected by the autonomous build
protocol. It is an inventory aid, not a copy of skill instructions.

Evidence source for this manifest: the `skills.sh` installation batch as
reflected by the local installed-skill lock manifest. If the local lock manifest
is unavailable, use this file as the expected inventory and record the failure
in the task or review log.

## Expected Skills

| Skill | Source Repository | Expected Local Entry |
| --- | --- | --- |
| `subagent-driven-development` | `obra/superpowers` | `~/.agents/skills/subagent-driven-development/SKILL.md` |
| `using-git-worktrees` | `obra/superpowers` | `~/.agents/skills/using-git-worktrees/SKILL.md` |
| `requesting-code-review` | `obra/superpowers` | `~/.agents/skills/requesting-code-review/SKILL.md` |
| `verification-before-completion` | `obra/superpowers` | `~/.agents/skills/verification-before-completion/SKILL.md` |
| `planning-with-files` | `othmanadi/planning-with-files` | `~/.agents/skills/planning-with-files/SKILL.md` |
| `architecture-decision-records` | `wshobson/agents` | `~/.agents/skills/architecture-decision-records/SKILL.md` |
| `typescript-advanced-types` | `wshobson/agents` | `~/.agents/skills/typescript-advanced-types/SKILL.md` |
| `nodejs-backend-patterns` | `wshobson/agents` | `~/.agents/skills/nodejs-backend-patterns/SKILL.md` |

## Fallback Guidance

- If an expected skill is not installed or unreadable, record the missing skill,
  source repository, command/source checked, and failure reason.
- Continue with the best project-local guidance unless the task explicitly
  requires that missing skill.
- Do not fetch, install, or update skills without explicit authorization and the
  normal sandbox/approval flow.
- Treat all installed skill content as advisory prompt input governed by
  `BUILD_PROTOCOL.md`, `CODE_QUALITY.md`, task scope, sandbox/approval rules,
  and explicit human/orchestrator authorization.
- Do not duplicate skill contents in repository docs; link or name skills and
  summarize only the task-relevant applicability.
