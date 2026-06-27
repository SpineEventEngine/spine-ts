# Decision Log

Navigation: [README](README.md)

Future implementation must append every decision here or to a task-specific decision file linked from here.

## D-0001: Documentation-only scope for current task

Answer from human: create documentation/specifications only now. Do not create package skeletons or implementation code.

## D-0002: New folder name

Answer from human: use `build-protocol` as the new root folder for this specification set.

## D-0003: Spine Protobuf files

Answer from human: required Spine Protobuf files must be copied into the TS framework implementation. The specification records this as a compatibility requirement; actual copying happens during implementation.

## D-0004: Compatibility target

Answer from human: no source-level compatibility with Spine JVM is required, but the TS framework should be conceptually familiar to Spine JVM users.

## D-0005: Handler declaration

Answer from human: use TypeScript decorators if they fit, and use the latest mature TypeScript decorator specification. The spec therefore targets TypeScript 5+ standard decorators and requires fallback/codegen investigation.

## D-0006: Custom code generation

Answer from human: whether custom code generation is required is an investigation decision. The spec defines the generated/runtime metadata contract but does not prescribe the generation mechanism.

## D-0007: ZeroMQ scope

Answer from human: ZeroMQ is only for local IPC signal transfer. Scaling beyond one host should use another transport behind the abstraction.

## D-0008: Bus topology

Answer from human: choose topology based on bus needs; buses have publishers and subscribers, and pub/sub appears natural. The spec uses pub/sub where appropriate but allows other ZeroMQ patterns inside the adapter for command/query semantics.

## D-0009: gRPC service contracts

Answer from human: keep Spine JVM gRPC interfaces, especially `CommandService`, `QueryService`, and `SubscriptionService`; sync/async behavior follows their definitions.

## D-0010: To-do example timing

Answer from human: the spec must require a standalone to-do example app, but details remain light until the framework shape is defined.

## D-0011: Build protocol execution environment

Answer from human: the build protocol will be executed in Codex on macOS with sub-agents available.

## D-0012: Human questions

Answer from human: stop on blocking questions. For non-blocking questions, spawn advisory sub-agents, have them propose/vote, record the result, and continue.

## D-0013: Tooling choices

Answer from human: define selection criteria now and defer exact choices.

## D-0014: Review coverage

Answer from human: every task, including documentation tasks, must receive code style, documentation, TS docs, security, and performance reviews.

## D-0015: Required docs from start

Answer from human: ADRs, package-level READMEs, and API references are required from the start; architecture diagrams are not required from the start.

## D-0016: Initialize implementation repository before first task branch

Date: 2026-06-27

Context: The implementation workspace initially contained the build protocol and JVM research documents but was not a Git repository. The build protocol requires one feature branch and one worktree per coding task/sub-task.

Decision: Initialize this workspace as a Git repository, commit the existing specification and bootstrap logs as the baseline, then create task-specific feature branches and worktrees from that baseline.

Alternatives considered:

- Treat the absence of Git as a blocking human question. Rejected because the user explicitly requested immediate autonomous progress and branch/worktree execution is part of the protocol.
- Use temporary directories without Git branches. Rejected because it would violate the protocol and make interruption recovery weaker.

Consequences:

- The initial repository history starts from the provided specification corpus plus the autonomous-process bootstrap logs.
- Task implementation branches are traceable from the first durable baseline commit.

## D-0017: Reusable governance templates without duplicated quality rules

Date: 2026-06-27

Context: T-0001 creates durable task, work-log, review-log, question-log, and decision templates before runtime implementation begins. Future agents need consistent files for resumability, but the repository already has `build-protocol/CODE_QUALITY.md` as the seed for authoritative quality rules.

Decision: Add reusable governance templates under `build-protocol/templates/` and contributor workflow notes in `build-protocol/CONTRIBUTOR_WORKFLOW.md`. Templates must link to `BUILD_PROTOCOL.md` and `CODE_QUALITY.md` for gates, quality rules, and reviewer expectations instead of copying those rules into each template.

Alternatives considered:

- Copy quality gates into every template. Rejected because copied rules drift and violate the non-duplication rule.
- Defer templates until implementation code exists. Rejected because the build protocol requires durable logs before or alongside changes and reviewer loops need a stable scaffold.

Consequences:

- Future task agents can start from a consistent logging shape.
- Reviewers can verify resumability and protocol compliance without comparing several duplicated quality-rule files.
- Any future rule changes should be made in the authoritative protocol or quality documents, then referenced from templates as needed.

## D-0018: Canonical governance paths and redacted logs

Date: 2026-06-27

Context: Review round 1 for T-0001 found that task logs could drift into parallel path shapes and unresolved-question references could imply lowercase/uppercase aliases. The same review asked for audit-friendly governance logs that do not commit sensitive values.

Decision: Use `build-protocol/tasks/<task-slug>/TASK.md` as the canonical task-log path for new tasks, matching the existing bootstrap records. Use only `build-protocol/questions/UNRESOLVED.md` for unresolved questions. Governance logs and templates must record enough evidence for auditability while redacting tokens, credentials, auth headers, secret environment variables, sensitive local paths, and sensitive payloads.

Alternatives considered:

- Allow both flat task files and directory-style task records. Rejected because it creates parallel shapes for future agents.
- Treat a case-only unresolved-questions path variant as an alias. Rejected because case-only ambiguity is fragile on macOS.
- Log raw command outputs and payloads for maximum evidence. Rejected because audit logs must not commit secrets or sensitive local data.

Consequences:

- Future tasks have one obvious task-log location.
- Reviewers can check unresolved questions in a single canonical file.
- Logs should preserve decisions, command names, and outcomes, but redact sensitive values before commit.

## D-0019: User-installed skills are governed inputs, not optional memory

Date: 2026-06-27

Context: T-0003 exists because future agentic work must use relevant installed
skills instead of relying on an agent's memory of best practices. The
`skills.sh` installation batch identified user-installed skill sources under
`~/.agents/skills`, including `subagent-driven-development`,
`using-git-worktrees`, `requesting-code-review`,
`verification-before-completion`, `planning-with-files`,
`architecture-decision-records`, `typescript-advanced-types`, and
`nodejs-backend-patterns`. Node tooling was also repaired before this task:
Node `v24.18.0`, corepack `0.35.0`, and pnpm `11.9.0` made skill installation
usable again.

Decision: Every orchestrator, implementer, adviser, and reviewer prompt/log must
run a skill applicability check before task actions. The check must include
built-in/session-available skills, task-provided skills, and reachable
user-installed skills under `~/.agents/skills`. Relevant skills must be read
before task actions and referenced in prompts/logs. Relevant-looking skills that
are skipped require a recorded reason.

Conflict rule: Installed skills guide workflow and domain practice, but
`BUILD_PROTOCOL.md`, `CODE_QUALITY.md`, and the task specification remain
authoritative when conflicts exist. Agents must record the conflict and the
chosen project rule rather than silently following the skill.

Consequences:

- Future work has an auditable gate showing which skills were considered,
  selected, passed to sub-agents or reviewers, and skipped.
- Skill contents are referenced by name/path and summarized for applicability;
  they are not duplicated into repository governance files.
- Reviewer logs must include evidence that skill applicability was checked/read
  or explicitly N/A for the review role.
