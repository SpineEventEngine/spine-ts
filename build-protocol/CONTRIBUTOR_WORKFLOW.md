# Contributor Workflow Notes

Navigation: [README](README.md) | Related: [Build Protocol](BUILD_PROTOCOL.md), [Code Quality](CODE_QUALITY.md), [Decision Log](DECISION_LOG.md)

These notes help implementation and reviewer agents apply the autonomous build protocol without restating the quality rules. When these notes conflict with `BUILD_PROTOCOL.md` or `CODE_QUALITY.md`, the protocol and quality documents are authoritative.

## Starting A Task

1. Work only in the task worktree assigned by the orchestrator.
2. Confirm the orchestrator's micro, standard, or high-risk classification.
   Create or update the task record in the same atomic initial step as the
   skill gate. Micro tasks use the combined template; standard and high-risk
   task logs use `build-protocol/tasks/<task-slug>/TASK.md`.
3. Read the task brief, `BUILD_PROTOCOL.md`, `CODE_QUALITY.md`, relevant specification docs, and the current task log before editing.
4. Confirm baseline commit, branch, worktree, and file responsibilities.
5. Use the orchestrator's recorded canonical skill applicability check. Fully
   read each selected skill that governs this role; do not repeat stable
   inventory or manifest discovery.
6. Record any skill, library, or tooling investigation attempts, including failures and the decision not to install or adopt a tool.

## While Working

- Keep edits within the task's assigned files.
- Do not revert or overwrite unrelated edits made by other agents.
- Update durable records at the meaningful resumability boundaries defined in
  `BUILD_PROTOCOL.md`, not for every isolated correction.
- Use `DECISION_LOG.md` or a linked task decision record for architectural or tooling choices.
- Put unresolved blocking and non-blocking questions in `build-protocol/questions/UNRESOLVED.md`; stop for blocking questions.
- Link to `CODE_QUALITY.md` for quality expectations instead of creating another quality-rule file.
- Record enough context for auditability, but never commit tokens, credentials, auth headers, secret environment variables, sensitive local paths, or sensitive payloads.
- Route accepted exceptions and deferrals through an Open Risks And Follow-Up Routing table with owner, linked task or decision, disposition, and next review point.

## Review Loop

Standard and high-risk tasks keep review-wave evidence; micro tasks keep review
dispositions in their combined record. Every task records a disposition for
the four canonical concerns defined in `BUILD_PROTOCOL.md` and
`CODE_QUALITY.md`, invoking only relevant existing reviewers:

- code style/maintainability;
- documentation completeness;
- TypeScript/API docs;
- performance/reliability.

Security remains the final release-readiness role unless the human explicitly
requests it earlier. Reviewer findings must be actionable, tied to files or
protocol requirements, and classified P0 through P3. The authoring agent
records accepted fixes, rejected findings, verification, and one aggregated
correction batch. Only substantively affected concerns are re-reviewed.

Reviewers should record the commit or diff basis, baseline, worktree path, dirty status, relevant documentation/API impact evidence, tests, coverage, and per-role coverage notes. Security reviewers must link or apply `CODE_QUALITY.md#security-standards` and state which areas are applicable or not applicable for the task.

Before reviewing, each reviewer reads the selected skills supplied for the
role. The reviewer reuses the task-level applicability evidence while scope,
role, and inventory remain stable, and verifies that the authoring record names
selected and skipped skills with reasons.

## Handoff And Resumption

Before stopping, every task branch should make the next action obvious from
the combined micro record or the standard/high-risk durable files:

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
