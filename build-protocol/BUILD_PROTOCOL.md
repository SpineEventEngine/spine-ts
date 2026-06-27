# BUILD_PROTOCOL

Navigation: [README](README.md) | Related: [Code Quality](CODE_QUALITY.md)

This protocol governs future autonomous development of the TypeScript framework in Codex on macOS with sub-agents and worktrees available.

## Prime Directive

The main agent must keep development resumable after sudden interruption, including computer restart, lost internet, or thread compaction. No change may be made without updating the appropriate log first or in the same atomic work step.

Required persistent files during implementation:

- `DECISION_LOG.md` for architectural/tooling decisions;
- task files for every task and sub-task;
- per-branch work logs;
- review logs for every reviewer round;
- unresolved questions log;
- package and API documentation.

## Agent Roles

Every development cycle uses:

- One orchestrating main agent.
- One requirements-splitting sub-agent.
- One implementing sub-agent per task or sub-task.
- Reviewer sub-agents for code style, documentation, TypeScript/API docs, security, and performance/reliability.

When spawning sub-agents, the orchestrator must instruct each to impersonate a senior engineer specializing in the assigned aspect.

## Work Breakdown

1. The orchestrator writes the initial task brief and updates the task log.
2. A dedicated splitting sub-agent decomposes requirements into tasks and sub-tasks.
3. The orchestrator reviews the split, asks blocking human questions, and records answers.
4. Each task/sub-task receives its own implementation branch and worktree.
5. One implementation sub-agent owns that task/sub-task branch.
6. Reviewers review only that branch.
7. Authoring sub-agent addresses review comments.
8. Review repeats until no comments remain.
9. The orchestrator integrates the branch.
10. All participating sub-agents are closed.

## Branch and Worktree Rules

- Use one feature branch per sub-agent coding session.
- Use worktrees to avoid sub-agents stepping on each other.
- Do not share write ownership of files unless the orchestrator explicitly serializes the edits.
- Keep branch names traceable to task IDs.
- Do not merge a branch until review rounds are complete and logs are updated.

## Review Loop

Each feature must receive these independent reviews:

- code style/maintainability;
- documentation completeness;
- TypeScript/API docs;
- security;
- performance/reliability.

Reviewer comments are fed back to the authoring sub-agent. The authoring sub-agent must:

- update code/docs/tests;
- update the task log;
- explain any rejected comment;
- request another review round.

The loop stops only when all reviewers report no remaining comments.

## Human Questions

Blocking questions:

- Stop work.
- Ask the human.
- Wait until answers are clear.
- Record the question and answer in the relevant task docs.
- Continue only after the answer is incorporated.

Non-blocking questions:

- The orchestrator spawns several advisory sub-agents to propose solutions.
- Advisory sub-agents vote or rank the proposed solutions.
- The orchestrator records the question, candidate solutions, vote result, chosen solution, and rationale in a separate decision file or `DECISION_LOG.md`.
- Work continues with the chosen solution.

## Skills and Tooling

Before implementing a typical task, the orchestrator must:

- search available Codex/agentic skills in well-known locations;
- install required skills when they are available and proven;
- search existing GitHub libraries before implementing common infrastructure;
- prefer current stable TS libraries and dev dependencies;
- document library selection criteria and final choices.

No sub-agent should invent infrastructure before checking available tools/libraries unless the task is explicitly novel.

## Logging Protocol

Every task/sub-task log must include:

- task ID and branch/worktree;
- authoring sub-agent ID;
- reviewer sub-agent IDs;
- start/end timestamps;
- human questions and answers;
- decisions made;
- files changed;
- tests run;
- coverage result;
- review rounds and outcomes;
- integration result.

Logs must be updated before or alongside changes so work can resume after interruption.

## Quality Gates

A task cannot be marked complete until:

- implementation goal is achieved;
- tests pass;
- coverage remains at or above 90%;
- docs are updated;
- TypeDoc/API docs are updated for public API changes;
- framework or example `USER_GUIDE.md` is updated when user workflow changes;
- all reviewer rounds are complete;
- all participating sub-agents are closed.

## Documentation Deliverables

From the start, the implementation repository must maintain:

- ADRs or decision records;
- package-level READMEs;
- framework `USER_GUIDE.md`;
- example app `USER_GUIDE.md`;
- TypeDoc/API reference generation;
- architecture notes.

Architecture diagrams are not required from the start, but should be added once the architecture stabilizes enough to make diagrams valuable.

## To-Do Example Requirement

The implementation roadmap must include a standalone to-do list server-side application built on top of the TS framework. It is a proof of usability and must be treated as part of acceptance, not as an afterthought.

## Agent Closure

Once a sub-agent completes its role, the orchestrator must close it. This applies to splitters, implementers, reviewers, fixers, and advisory sub-agents.

