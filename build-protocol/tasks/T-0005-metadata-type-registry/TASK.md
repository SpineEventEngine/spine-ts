# T-0005: Metadata And Type Registry

Status: Ready for implementation branch
Start: `2026-06-28 15:58 WEST`
End: Pending
Baseline commit: `8a051f6`
Task log path: `build-protocol/tasks/T-0005-metadata-type-registry/TASK.md`
Branch: `task/T-0005-registry-core`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0005-registry-core`
Authoring sub-agent: Pending
Reviewer sub-agents: Pending
Implementation commit: Pending branch commit
Final branch HEAD: Pending branch commit

## Objective

Implement the first runtime metadata and type registry layer over Protobuf-ES
schemas. The task must make generated Spine schemas discoverable by full type
name and type URL, expose deterministic type URL derivation, preserve access to
custom options and descriptor-backed metadata needed by later validation and
runtime tasks, and document the public API.

## Required Inputs Read

- `build-protocol/README.md`
- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/DECISION_LOG.md`
- `build-protocol/skills/EXPECTED_SKILLS.md`
- `build-protocol/tasks/T-0004-proto-intake/TASK.md`

## Requirements Splitter Output

Requirements splitter: `019f0ebf-55fa-7c73-9790-387d2b3b9b13`.

Current roadmap source: T-0004 selected the following post-proto sequence:

1. `T-0005 Metadata And Type Registry`
2. `T-0006 Validation Facade`
3. `T-0007 Core Envelopes And Context`
4. `T-0008 Storage Foundation`
5. `T-0009 Entity And Handler Model`
6. `T-0010 Single-Process Async Runtime`
7. `T-0011 Read Side And Todo Thin Slice`

Blocking questions: none known at task creation; the splitter reported no
blocking questions.

Splitter output:

1. Registry seam and ownership: choose `@spine-ts/core` for runtime registry
   APIs and keep `@spine-ts/proto` focused on generated contracts.
2. Core type registry slice: derive deterministic type URLs, register current
   curated schemas, lookup by full name/type URL/schema, reject duplicates, and
   expose unknown lookup behavior.
3. Descriptor-backed metadata extraction: expose file name, file descriptor,
   first field, declaration order where reliable, and option access helpers
   from Protobuf-ES descriptors.
4. Rich Spine option and semantic metadata: expose entity, column, `(is)`,
   `(every_is)`, and validation option metadata only where current descriptors
   and copied protos make it provable; use fixtures or defer with a recorded
   decision if needed.
5. Integration docs and review closure: update decision logs, package docs,
   TypeDoc/API docs, architecture notes, user guide, task/work/review logs, and
   run the five-reviewer loop.

First non-blocked implementable slice: core registry in `packages/core`, branch
`task/T-0005-registry-core`, worktree `.worktrees/T-0005-registry-core`.

## Skill Applicability

Canonical checklist: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Skill sources checked:

| Source                                     | Scope Checked                                    | Evidence                                                                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session skill inventory                    | Task-relevant subset available in session prompt | Relevant visible skills include `subagent-driven-development`, `using-git-worktrees`, `requesting-code-review`, `verification-before-completion`, `implement`, `test-driven-development`, and TypeScript/backend skills. |
| Task-provided skill names/paths            | User request and protocol requirements           | User explicitly required installed skills to be used in agentic work where needed; `BUILD_PROTOCOL.md` requires the canonical skill applicability check.                                                                 |
| `build-protocol/skills/EXPECTED_SKILLS.md` | Checked                                          | Expected manifest includes required protocol skills for sub-agent execution, worktrees, review handoff, verification, planning, ADRs, TypeScript, and Node backend patterns.                                             |
| `~/.agents/skills/*/SKILL.md`              | Full directory, bounded listing                  | `find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md -print` showed the expected protocol and TypeScript/backend skills are reachable.                                                                              |
| `~/.agents/.skill-lock.json`               | Checked                                          | Lock manifest is reachable and records expected installed skills and source repositories.                                                                                                                                |

Selected skills read before task actions:

| Skill                            | Source                                                     | Applicability                                                                 | Instructions Applied                                                                                                 |
| -------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `subagent-driven-development`    | `~/.agents/skills/subagent-driven-development/SKILL.md`    | User and protocol require splitter, implementer, reviewers, and durable logs. | Use one orchestrator, one splitter, one implementation worker, independent reviewers, and durable progress records.  |
| `using-git-worktrees`            | `~/.agents/skills/using-git-worktrees/SKILL.md`            | T-0005 needs an isolated branch/worktree.                                     | Detect existing isolation, verify project-local worktree ignore state, then create a traceable worktree.             |
| `requesting-code-review`         | `~/.agents/skills/requesting-code-review/SKILL.md`         | T-0005 must run the five-reviewer loop.                                       | Prepare branch diff and role-specific review prompts before integration.                                             |
| `verification-before-completion` | `~/.agents/skills/verification-before-completion/SKILL.md` | Required before claiming task completion or moving to the next task.          | Require fresh verification output before completion claims, commits, and integration.                                |
| `implement`                      | `~/.agents/skills/implement/SKILL.md`                      | Implementation worker must execute a concrete task and commit work.           | Worker must implement from task docs, verify regularly, run review, and commit.                                      |
| `test-driven-development`        | `~/.agents/skills/test-driven-development/SKILL.md`        | T-0005 adds runtime behavior and must be test-first.                          | New behavior starts with failing Vitest tests before production code.                                                |
| `architecture-decision-records`  | `~/.agents/skills/architecture-decision-records/SKILL.md`  | Registry shape and type URL policy are architectural compatibility decisions. | Record context, decision, alternatives, and consequences for registry design choices.                                |
| `typescript-advanced-types`      | `~/.agents/skills/typescript-advanced-types/SKILL.md`      | Registry APIs need schema/type-safe public surfaces.                          | Prefer explicit generics and public API types without overcomplicating the first metadata slice.                     |
| `nodejs-backend-patterns`        | `~/.agents/skills/nodejs-backend-patterns/SKILL.md`        | Framework runtime APIs are Node.js backend infrastructure.                    | Keep ESM, error handling, lifecycle, and dependency hygiene in view; avoid server/runtime transport scope in T-0005. |
| `javascript-testing-patterns`    | `~/.agents/skills/javascript-testing-patterns/SKILL.md`    | T-0005 needs focused Vitest coverage for metadata/registry behavior.          | Use behavior-level unit tests and regression checks for duplicate registration and lookup failures.                  |
| `codebase-design`                | `~/.agents/skills/codebase-design/SKILL.md`                | Metadata registry is a core module boundary used by later validation/runtime. | Keep the registry interface cohesive and deep enough for future tasks without leaking implementation details.        |

Skills passed to sub-agents/reviewers:

| Recipient             | Skills/Instructions Passed                                                                                                                | Notes                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Requirements splitter | Protocol docs, T-0004 roadmap, T-0005 objective, expected skills, and current task logs                                                   | Splitter must refine T-0005 into implementable sub-tasks.       |
| T-0005 implementation | Selected skill list above, `EXPECTED_SKILLS.md`, and task/protocol requirements                                                           | Worker must run its own skill gate and record updated evidence. |
| T-0005 reviewers      | Required review roles plus skill gate, selected skills, `CODE_QUALITY.md`, T-0005 task/work/review logs, and branch verification evidence | Reviewers must run their own skill gate for their role.         |

Skipped relevant-looking skills:

| Skill                                                                                    | Source                   | Reason Skipped                                                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `planning-with-files`                                                                    | Expected manifest        | The repository already has mandatory durable task/work/review logs for T-0005.                            |
| `api-design-principles`                                                                  | Installed skill metadata | T-0005 designs an in-process TypeScript module API, not REST or GraphQL.                                  |
| `cqrs-implementation`, `projection-patterns`, `event-store-design`, `saga-orchestration` | Installed skill metadata | Relevant to later read/write/runtime tasks, not this registry slice.                                      |
| `security-threat-model`, `stride-analysis-patterns`, `threat-mitigation-mapping`         | Installed skill metadata | Security review is required, but T-0005 is not a dedicated threat-model task.                             |
| `webapp-testing`, `accessibility`, `web-quality-audit`, `performance`                    | Installed skill metadata | No frontend/web application is changed; performance/reliability is covered by the required reviewer role. |

Conflict resolution: repository protocol, `CODE_QUALITY.md`, task scope,
sandbox/approval rules, and explicit human/orchestrator authorization override
installed skill advice.

## Scope

In scope:

- Define a public metadata/registry package surface for Protobuf-ES schemas.
- Register generated Spine schemas by full type name and deterministic type URL.
- Support schema lookup by full name, type URL, schema, and semantic tag where
  the currently copied descriptors expose enough data.
- Expose descriptor-backed metadata needed by later validation/runtime tasks:
  file name, declaration order where practical, custom options visibility,
  and type URL prefix preservation.
- Add tests for registration, lookup, duplicate rejection, unknown lookup
  errors/results, schema-to-type-URL mapping, and option/tag visibility for the
  currently copied proto closure.
- Update package README, framework user guide, TypeDoc/API docs, architecture
  notes, and decision log as needed.

Out of scope:

- `@spine-event-engine/validation-ts` integration and validation facade behavior.
- State-transition validation such as `(set_once)`.
- Runtime buses, storage, envelopes, decorators, handlers, and ZeroMQ transport.
- Copying additional Spine proto files unless the registry implementation cannot
  be usefully verified against the existing T-0004 proto closure.
- Custom code generation beyond Protobuf-ES unless the splitter identifies a
  blocker that descriptors cannot satisfy.

## Work Log

- `2026-06-28 15:58 WEST`: Orchestrator selected T-0005 from the T-0004
  roadmap, read the governing protocol/spec sections, performed the initial
  skill applicability check, and created the initial task/work/review logs
  before splitter delegation.
- `2026-06-28 16:02 WEST`: Requirements splitter
  `019f0ebf-55fa-7c73-9790-387d2b3b9b13` returned no blocking questions,
  produced the staged breakdown, and recommended the first implementable slice
  as `task/T-0005-registry-core` in `packages/core`. Orchestrator closed the
  splitter and recorded `D-0027`/`D-0028`.

## Decisions

- `D-0027`: Put the first runtime type registry in `@spine-ts/core`.
- `D-0028`: T-0005 registry lookup and type URL policy.
- Still pending during implementation: whether Protobuf-ES descriptors are
  sufficient for first-field/declaration-order and rich Spine option metadata.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none recorded yet.

## Files Changed

- `build-protocol/tasks/T-0005-metadata-type-registry/TASK.md`
- `build-protocol/work-logs/T-0005.md`
- `build-protocol/reviews/T-0005-metadata-type-registry.md`
- `build-protocol/DECISION_LOG.md`

## Tests Run

- Pending.

## Coverage Result

- Pending.

## Documentation And Public API Impact

| Area                          | Impact                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| Package README impact         | Expected for registry public API.                                                         |
| TypeDoc/API docs impact       | Expected for public registry APIs and exported types.                                     |
| Public API additions/removals | Expected public metadata/registry exports.                                                |
| Framework `USER_GUIDE.md`     | Expected short usage note for registry/type URL lookup.                                   |
| Example `USER_GUIDE.md`       | Not expected unless splitter expands scope into to-do example code.                       |
| API examples                  | Expected package README and docs examples for registering/looking up generated schemas.   |
| Compatibility notes           | Expected note on descriptor-sufficient metadata and deferred custom generation questions. |

## Security Impact

| Area                  | Impact                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Dependencies          | No new dependency expected unless implementation proves a need and records a decision.      |
| Secrets/credentials   | No secrets expected.                                                                        |
| IPC                   | Out of scope.                                                                               |
| Validation            | Registry enables later validation but does not validate messages in T-0005.                 |
| Tenant boundaries     | Out of scope.                                                                               |
| `Any`/deserialization | Registry maps type URLs to schemas; unsafe unpacking/`Any` deserialization is out of scope. |
| Logging               | No sensitive data logging expected.                                                         |

## Verification

- Pending.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up                                                     | Owner              | Linked Task/Decision | Disposition | Next Review Point               |
| ------------------------------------------------------------------ | ------------------ | -------------------- | ----------- | ------------------------------- |
| Descriptor data may not expose all Spine custom options uniformly. | T-0005 implementer | Pending decision     | Open        | Requirements splitter and tests |
| Semantic tags may be limited by the current four-file proto set.   | T-0005 implementer | T-0004               | Open        | T-0005 implementation review    |

## Review Rounds

- Pending.

## Integration Result

Pending.
