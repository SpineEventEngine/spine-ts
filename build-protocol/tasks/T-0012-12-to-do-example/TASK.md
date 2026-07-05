# T-0012.12: To-Do Example

Status: splitting in progress
Start: `2026-07-05 10:53 WEST`
End: Pending
Baseline commit: `89868e9`
Task log path: `build-protocol/tasks/T-0012-12-to-do-example/TASK.md`
Branch: `task/T-0012-12-to-do-example`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12-to-do-example`
Authoring sub-agent: Pending splitter; implementation sub-agent pending split.
Reviewer sub-agents: Pending
Implementation commit: Pending branch commit
Final branch HEAD: Pending branch commit

## Objective

Replace the placeholder `examples/todo` workspace with a real standalone
server-side to-do app that uses the framework as an application developer would:
generated Protobuf-ES domain messages, decorated aggregate command handlers,
event appliers, projection subscribers, real `CommandService`, `QueryService`,
and `SubscriptionService` behavior, in-memory storage, validation, a business
refusal path, black-box tests, and an example `USER_GUIDE.md`.

If the example exposes a missing framework feature, pause the example slice,
record the gap, implement the missing framework feature under the same
autonomous protocol, and then resume the example.

## Required Inputs Read

- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/tasks/T-0012-11-missing-details-example-readiness/TASK.md`
- `build-protocol/tasks/T-0012-11-missing-details-example-readiness/IMPLEMENTATION_REPORT.md`
- `examples/todo/README.md`
- `examples/todo/USER_GUIDE.md`
- `examples/todo/src/index.ts`
- `examples/todo/src/index.test.ts`

## Skill Applicability

Canonical checklist evidence for `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Skill sources checked:

| Source                                              | Scope Checked                                       | Evidence                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session skill inventory                             | Task-relevant subset visible in the current session | Selected workflow skills: `subagent-driven-development`, `using-git-worktrees`, `requesting-code-review`, `receiving-code-review`, `verification-before-completion`; relevant advisory skills noted below.                                                                                                                |
| Task-provided skill names/paths                     | N/A                                                 | The user did not name a new skill for `T-0012.12`; continuing with protocol-required installed skills.                                                                                                                                                                                                                    |
| `build-protocol/skills/EXPECTED_SKILLS.md`          | Checked                                             | Expected autonomous skills include sub-agent, worktree, review, verification, planning, ADR, TS, and Node backend skills.                                                                                                                                                                                                 |
| `~/.agents/skills/*/SKILL.md`                       | Full readable directory listing                     | `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print` found installed task-relevant skills including `epic-breakdown-advisor`, `codebase-design`, `domain-modeling`, `cqrs-implementation`, `projection-patterns`, `javascript-testing-patterns`, `nodejs-backend-patterns`, and protocol skills. |
| `~/.agents/.skill-lock.json` or equivalent manifest | Checked first portion and task-relevant entries     | Lock manifest is readable and records installed user skills from sources including `deanpeters/Product-Manager-Skills`, `mattpocock/skills`, and `wshobson/agents`; no skill install is needed for this task.                                                                                                             |

Selected skills read before task actions:

| Skill                            | Source                                                                    | Applicability                                                         | Instructions Applied                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `subagent-driven-development`    | Session skill, `~/.agents/skills/subagent-driven-development/SKILL.md`    | Governs splitter, implementer, review loop, and continuous execution. | Use fresh sub-agents for splitting, implementation, and review; do not pause between tasks without a real blocker; close agents promptly. |
| `using-git-worktrees`            | Session skill, `~/.agents/skills/using-git-worktrees/SKILL.md`            | Required by project protocol for one branch/worktree per task.        | Created `task/T-0012-12-to-do-example` in `.worktrees/T-0012-12-to-do-example` from `main@89868e9`.                                       |
| `requesting-code-review`         | Session skill, `~/.agents/skills/requesting-code-review/SKILL.md`         | Required review after each task/slice.                                | Use bounded diff packages and route all required lanes through reviewer sub-agents.                                                       |
| `receiving-code-review`          | Session skill, `~/.agents/skills/receiving-code-review/SKILL.md`          | Required for handling reviewer comments.                              | Verify comments against code and fix concrete findings before re-review.                                                                  |
| `verification-before-completion` | Session skill, `~/.agents/skills/verification-before-completion/SKILL.md` | Required before completion claims, commits, and integration.          | Run fresh verification and record command results before claiming readiness.                                                              |

Skills passed to sub-agents/reviewers:

| Recipient                 | Skills/Instructions Passed                                                                                                                                                                                                                | Notes                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Requirements splitter     | `subagent-driven-development`, `epic-breakdown-advisor`, `codebase-design`, `domain-modeling`, `cqrs-implementation`, `projection-patterns`, `nodejs-backend-patterns`, `javascript-testing-patterns`; project protocol overrides skills. | Splitter must produce small implementation slices, identify any framework gaps, and record skill applicability. |
| Implementation sub-agents | Pending split.                                                                                                                                                                                                                            | Each implementer receives the applicable slice skills and exact write scope.                                    |
| Reviewers                 | Pending split.                                                                                                                                                                                                                            | Each reviewer receives the required lane plus review/verification skill references.                             |

Skipped relevant-looking skills:

| Skill                     | Source                                            | Reason Skipped                                                                                                                                 |
| ------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-design-principles`   | `~/.agents/skills/api-design-principles/SKILL.md` | Example should use existing Spine service APIs and generated Protobuf contracts, not design a new public API unless a framework gap is proven. |
| `architecture-patterns`   | `~/.agents/skills/architecture-patterns/SKILL.md` | Current protocol and Spine JVM familiarity already constrain architecture; use only if a split reveals a framework architecture gap.           |
| `event-store-design`      | `~/.agents/skills/event-store-design/SKILL.md`    | Event store already exists for this task; do not redesign storage while building the example.                                                  |
| `security-best-practices` | Session skill                                     | Not explicitly requested as a standalone security report; security review lane remains mandatory.                                              |

Conflict resolution: project protocol, human instructions, `CODE_QUALITY.md`,
Spine Protobuf contracts, sandbox/approval rules, and explicit task scope win
over installed-skill advice.

## Scope

In scope:

- Split the example work before implementation.
- Replace placeholder example metadata with runnable domain/server code.
- Add example `.proto` definitions and generated-code workflow using Buf /
  Protobuf-ES; generated files must remain ignored.
- Demonstrate command posting, aggregate command handling, event production,
  projection updates, projection queries, subscriptions, validation failure,
  and a business refusal.
- Use real framework gRPC services; no simulation.
- Use in-memory storage.
- Add black-box tests through `@spine-ts/testing`.
- Update example README and `USER_GUIDE.md`.
- Update framework docs/API docs only if the example exposes a framework gap
  requiring framework changes.

Out of scope:

- Production storage.
- New broad server facade or process supervisor unless a concrete example gap
  proves it is required.
- Client DSL work unless required to exercise real gRPC services.
- Worker/process fan-out beyond existing bus/transport abstractions unless
  required by a recorded framework gap.
- Rewriting Spine service proto definitions.

## Work Log

- `2026-07-05 10:53 WEST`: Created task branch/worktree and began durable logs
  before implementation. The root checkout still has unrelated untracked
  `human-review-1-jul.md`, which is outside this task.

## Decisions

- Existing architecture decisions in `build-protocol/DECISION_LOG.md` remain
  binding.
- No new tooling decision has been made yet. The splitter must record any
  library/tool recommendation before implementation.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none.

## Files Changed

- Pending split.

## Tests Run

- Pending split.

## Coverage Result

- Pending split.

## Documentation And Public API Impact

| Area                             | Impact                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Package README impact            | Example README must be updated from placeholder to runnable app guide.                                                            |
| TypeDoc/API docs impact          | Pending split; required if public framework API changes.                                                                          |
| Public API additions/removals    | Pending split; avoid unless a framework gap is proven.                                                                            |
| Framework `USER_GUIDE.md` impact | Pending split; required if example reveals missing framework guidance.                                                            |
| Example `USER_GUIDE.md` impact   | Required; the guide must explain generation, startup, command posting, querying, subscriptions, tests, and demonstrated features. |
| API examples                     | Required through runnable example code and guide snippets.                                                                        |
| Compatibility notes              | Pending split.                                                                                                                    |

## Security Impact

| Area                    | Impact                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| Dependencies            | Pending split; avoid new dependencies unless justified.                                                         |
| Secrets and credentials | Example must not use secrets or committed credentials.                                                          |
| IPC                     | Pending split; if local multi-process/transport is exercised, keep ZeroMQ hidden behind transport abstractions. |
| Validation              | Required: demonstrate validation failure through framework validation.                                          |
| Tenant boundaries       | Required: preserve tenant handling in command/query/subscription tests.                                         |
| `Any`/deserialization   | Required: pack/unpack generated Protobuf messages through existing framework contracts.                         |
| Logging                 | Example logs must not expose sensitive payloads or invent audit infrastructure.                                 |

## Verification

- Pending split and implementation.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up                                                                             | Owner             | Linked Task/Decision | Disposition                                                                                    | Next Review Point                                |
| ------------------------------------------------------------------------------------------ | ----------------- | -------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| The placeholder example may expose missing framework features when turned into a real app. | Main orchestrator | This task            | Accepted; route each proven gap into a framework slice before resuming example implementation. | Splitter output and first implementation review. |

## Review Rounds

- Pending.

## Integration Result

Pending.
