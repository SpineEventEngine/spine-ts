# Contributor Workflow Notes

Navigation: [README](README.md) | Related: [Build Protocol](BUILD_PROTOCOL.md), [Code Quality](CODE_QUALITY.md), [Decision Log](DECISION_LOG.md)

These notes help implementation and reviewer agents apply the autonomous build protocol without restating the quality rules. When these notes conflict with `BUILD_PROTOCOL.md` or `CODE_QUALITY.md`, the protocol and quality documents are authoritative.

## Starting A Task

1. Work only in the task worktree assigned by the orchestrator.
2. Read the task brief, `BUILD_PROTOCOL.md`, `CODE_QUALITY.md`, relevant specification docs, and the current task log before editing.
3. Confirm baseline commit, branch, worktree, and ownership boundaries.
4. Create or update the task log before or in the same atomic step as any other change. New task logs use `build-protocol/tasks/<task-slug>/TASK.md`.
5. Record any skill, library, or tooling investigation attempts, including failures and the decision not to install or adopt a tool.

## While Working

- Keep edits within the task ownership boundary.
- Do not revert or overwrite unrelated edits made by other agents.
- Update the task log and branch work log whenever scope, files, verification, or decisions change.
- Use `DECISION_LOG.md` or a linked task decision record for architectural or tooling choices.
- Put unresolved blocking and non-blocking questions in `build-protocol/questions/UNRESOLVED.md`; stop for blocking questions.
- Link to `CODE_QUALITY.md` for quality expectations instead of creating another quality-rule file.
- Record enough context for auditability, but never commit tokens, credentials, auth headers, secret environment variables, sensitive local paths, or sensitive payloads.
- Route accepted exceptions and deferrals through an Open Risks And Follow-Up Routing table with owner, linked task or decision, disposition, and next review point.

## Review Loop

Each task must keep a review log per reviewer round. The required reviewer perspectives are defined in `BUILD_PROTOCOL.md` and `CODE_QUALITY.md`:

- code style/maintainability;
- documentation completeness;
- TypeScript/API docs;
- security;
- performance/reliability.

Reviewer findings must be actionable and tied to files or protocol requirements. The authoring agent records accepted fixes, explicit exceptions, verification commands, and the next review request in the task log.

Reviewers should record the commit or diff basis, baseline, worktree path, dirty status, relevant documentation/API impact evidence, tests, coverage, and per-role coverage notes. Security reviewers must link or apply `CODE_QUALITY.md#security-standards` and state which areas are applicable or not applicable for the task.

## Handoff And Resumption

Before stopping, every task branch should make the next action obvious from durable files:

- task log status and latest work-log entry;
- files changed;
- verification already run and still pending;
- tests run and coverage result, including explicit N/A or exception rationale;
- documentation and public API impact;
- security impact and redaction-sensitive logging notes;
- reviewer comments and outcomes;
- unresolved questions;
- decisions made;
- open risks, owners, dispositions, and next review points;
- integration or closure state.

The next agent should be able to resume from the task log and branch work log without relying on chat history.
