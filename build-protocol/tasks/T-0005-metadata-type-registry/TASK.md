# T-0005: Metadata And Type Registry

Status: Complete; integrated into `main`
Start: `2026-06-28 15:58 WEST`
End: `2026-06-28 17:19 WEST`
Baseline commit: `80714f3`
Task log path: `build-protocol/tasks/T-0005-metadata-type-registry/TASK.md`
Branch: `task/T-0005-registry-core`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0005-registry-core`
Authoring sub-agent: T-0005 implementation sub-agent
Reviewer sub-agents: Round 2 plus focused docs re-check completed with no remaining comments
Implementation commit: `5705890eb5cdedaa2044375c6d5cccc304bdf283`
Review round 1 fix commit: `a8ad2fad6070479f156cb54211b14f6bfdb80117`
Review round 1 log cleanup commits: `a46a95a2efb8c75a613bda7390d0fa008931d3aa`,
`9e234fd083d2f4d1773acfc1526bbd0e120b2bcd`,
`350fc318e114b99061484c99d70d062a47a971d6`
Final review basis: latest branch HEAD after focused docs re-check cleanup
Merge commit: `2fcec21`

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
- `2026-06-28 16:06 WEST`: Orchestrator created isolated branch/worktree
  `task/T-0005-registry-core` at `.worktrees/T-0005-registry-core` from
  baseline `80714f3`.
- `2026-06-28 16:09 WEST`: Orchestrator ran baseline verification in the
  T-0005 worktree before implementation handoff.
- `2026-06-28 16:14 WEST`: T-0005 implementer performed the required
  implementer skill applicability check, confirmed the existing linked
  worktree/branch, and added the first failing registry behavior tests before
  production registry code.
- `2026-06-28 16:19 WEST`: Focused RED run
  `CI=true corepack pnpm vitest run packages/core/src/index.test.ts` executed
  and failed 8/8 tests because the registry exports/behavior did not exist yet;
  workspace package links were refreshed with escalated `corepack pnpm install`
  after the sandboxed install hit npm DNS failures.
- `2026-06-28 16:21 WEST`: Implemented the registry core in `@spine-ts/core`
  and reran the focused test; GREEN run passed 8/8 tests. Semantic tag lookup
  remains API-shaped but intentionally empty for the current copied proto
  closure because no registered `(is)`/`(every_is)` consumers are present.
- `2026-06-28 16:22 WEST`: First `CI=true corepack pnpm typecheck` failed
  because file option helper generics allowed arbitrary descriptor extensions;
  narrowed the public helper type to file-option extensions before rerunning.
- `2026-06-28 16:23 WEST`: Second `CI=true corepack pnpm typecheck` still
  failed because TypeScript did not reduce the conditional descriptor type for
  `Extension extends FileOptionExtension`; changed helpers to generic over the
  file option value shape instead.
- `2026-06-28 16:24 WEST`: Focused verification after docs/API updates:
  typecheck, lint, docs check, and focused registry test passed; format check
  failed only for `packages/core/src/index.ts` and the T-0005 work log, so
  targeted Prettier cleanup follows.
- `2026-06-28 16:25 WEST`: Ran targeted Prettier cleanup for the two files
  reported by format check.
- `2026-06-28 16:27 WEST`: Full `CI=true corepack pnpm verify` passed on the
  registry implementation; while reviewing public exports, added
  `FileOptionExtension` to the TypeDoc expected core export assertions before
  final verification rerun.
- `2026-06-28 16:28 WEST`: Final `CI=true corepack pnpm verify` passed on the
  final implementation tree: 8 test files, 20 tests, coverage above the 90%
  gate, docs check, proto lint/generate, and generated output clean.

## Decisions

- `D-0027`: Put the first runtime type registry in `@spine-ts/core`.
- `D-0028`: T-0005 registry lookup and type URL policy.
- Protobuf-ES descriptors are sufficient for this slice's full name, file,
  first-field, type URL prefix, and file-option metadata.
- Semantic tag extraction from `(is)` and `(every_is)` consumers is deferred:
  the current copied proto closure defines options but has no registered
  message consumers that make runtime tag metadata provable.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none recorded yet.

## Files Changed

- `build-protocol/tasks/T-0005-metadata-type-registry/TASK.md`
- `build-protocol/work-logs/T-0005.md`
- `build-protocol/reviews/T-0005-metadata-type-registry.md`
- `pnpm-lock.yaml`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `scripts/check-api-docs.mjs`
- `packages/core/package.json`
- `packages/core/README.md`
- `packages/core/src/index.test.ts`
- `packages/core/src/index.ts`
- `packages/core/tsconfig.json`

## Tests Run

- RED: `CI=true corepack pnpm vitest run packages/core/src/index.test.ts`
  failed 8/8 tests before production registry implementation because
  `deriveTypeUrl`, `TypeRegistry`, and `createSpineCoreRegistry` were missing.
- GREEN: `CI=true corepack pnpm vitest run packages/core/src/index.test.ts`
  passed 8/8 tests after the registry implementation.
- Typecheck attempt 1: `CI=true corepack pnpm typecheck` failed on
  `packages/core/src/index.ts` file option helper generic bounds; fix applied.
- Typecheck attempt 2: `CI=true corepack pnpm typecheck` failed on the same
  helper conditional type reduction; helper generic shape changed.
- Typecheck attempt 3: `CI=true corepack pnpm typecheck` passed.
- Focused checks: `CI=true corepack pnpm lint`, `CI=true corepack pnpm docs:check`,
  and `CI=true corepack pnpm vitest run packages/core/src/index.test.ts` passed.
- Format check attempt 1: `CI=true corepack pnpm format:check` failed for
  `packages/core/src/index.ts` and `build-protocol/work-logs/T-0005.md`.
- Targeted formatting: `corepack pnpm prettier --write packages/core/src/index.ts build-protocol/work-logs/T-0005.md`.
- Full verify attempt 1: `CI=true corepack pnpm verify` passed with 8 test
  files, 20 tests, coverage above 90%, docs check, proto lint/generate, and
  generated-output cleanliness. A final rerun is required after the log/API
  assertion update.
- Full verify final: `CI=true corepack pnpm verify` passed with 8 test files,
  20 tests, coverage above 90%, docs check, proto lint/generate, and
  generated-output cleanliness.
- Review round 1 RED: `CI=true corepack pnpm vitest run packages/core/src/index.test.ts`
  failed 2/10 tests before review-fix production changes, proving explicit type
  URL validation and the read-only default registry view were missing.
- Review round 1 GREEN focused checks:
  `CI=true corepack pnpm vitest run packages/core/src/index.test.ts` passed
  10/10 tests; `CI=true corepack pnpm typecheck` passed; `CI=true corepack pnpm docs:check`
  passed with the known TypeDoc invalid `origin` warning and 12 expected
  `@spine-ts/core` exports asserted.
- Review round 1 full verify attempt 1: `CI=true corepack pnpm verify` failed
  after 22/22 tests passed because function coverage was 88.88%, below the 90%
  threshold. Focused tests were expanded to cover read-only lookup delegation
  methods and semantic-tag indexing.
- Review round 1 focused rerun:
  `CI=true corepack pnpm vitest run packages/core/src/index.test.ts` passed
  11/11 tests after coverage assertions were added.
- Review round 1 full verify final: `CI=true corepack pnpm verify` passed with
  8 test files, 23 tests, coverage statements 98.91%, branches 96.96%,
  functions 100%, lines 98.91%, docs check, proto lint/generate, and generated
  output cleanliness.

## Coverage Result

- Final coverage from `CI=true corepack pnpm verify`: statements 98.91%,
  branches 96.96%, functions 100%, lines 98.91%.

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

Documentation updates completed for package README, framework user guide, API
reference notes/checks, and architecture notes. TypeDoc checks assert the new
public `@spine-ts/core` exports.

Review round 1 adds the public `TypeRegistryLookup` read-only interface to the
API-doc assertion set and documents that the shared `spineCoreRegistry` cannot
mutate the process-wide curated registry.

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

- `git worktree add .worktrees/T-0005-registry-core -b task/T-0005-registry-core main`
  created the implementation worktree at baseline `80714f3`.
- Baseline `CI=true corepack pnpm verify` passed in the T-0005 worktree: 8 test
  files and 13 tests passed, coverage 100%, docs check passed with the known
  TypeDoc invalid `origin` warning, proto lint/generate passed, and generated
  output was clean.
- Final `CI=true corepack pnpm verify` passed after implementation: 8 test
  files and 20 tests passed; coverage statements 94.52%, branches 92%,
  functions 93.75%, lines 94.52%; docs check passed with the known TypeDoc
  invalid `origin` warning; proto lint/generate passed; generated output was
  clean.
- Review round 1 final `CI=true corepack pnpm verify` passed: 8 test files and
  23 tests passed; coverage statements 98.91%, branches 96.96%, functions 100%,
  lines 98.91%; docs check passed with the known TypeDoc invalid `origin`
  warning; proto lint/generate passed; generated output was clean.
- Final branch `CI=true corepack pnpm verify` passed after focused docs
  re-check cleanup: 8 test files and 23 tests passed; coverage statements
  98.91%, branches 96.96%, functions 100%, lines 98.91%; docs check passed with
  the known TypeDoc invalid `origin` warning; proto lint/generate passed;
  generated output was clean.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up                                                     | Owner              | Linked Task/Decision | Disposition                                                                                              | Next Review Point                 |
| ------------------------------------------------------------------ | ------------------ | -------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Descriptor data may not expose all Spine custom options uniformly. | T-0005 implementer | D-0028               | Resolved for T-0005 file/first-field metadata; richer validation/entity options deferred to later tasks. | Validation/entity metadata tasks  |
| Semantic tags may be limited by the current four-file proto set.   | T-0005 implementer | T-0004, D-0028       | Deferred with future-compatible lookup API; no provable current consumers.                               | Validation/routing metadata tasks |

## Review Rounds

- Review round 1 reviewer IDs:
  - Maintainability: `019f0edc-1a7b-7ba1-8c3f-0645ebc1db57`
  - Documentation: `019f0edc-4344-7bf1-a173-b5003e4855c2`
  - TypeScript/API docs: `019f0edc-756c-7101-9d1e-81c7709dfab7`
  - Security: `019f0edc-a25e-7e03-87fe-482060e40d9d`
  - Performance/reliability: `019f0edc-c7e1-7ff1-89f3-fcc97abb8f1f`
- Review round 1 findings verified and fixed in one consolidated pass: mutable
  default registry exposure, unvalidated explicit type URLs, erased concrete
  schema type on schema lookup methods, stale durable log fields, and D-0028's
  missing fallback prefix value.
- Review round 2 reviewer IDs:
  - Maintainability: `019f0ef3-7250-7a72-a71e-69e8ca886c05`, no comments.
  - Documentation: `019f0ef3-9fca-73f2-bbe1-f516eae40fad`, stale review-basis
    wording fixed by the round-2 log-only correction.
  - TypeScript/API: `019f0ef3-c703-7e41-8279-3e6d5d553a20`, no comments.
  - Security: `019f0ef3-f963-76c0-9da2-3e9c1df57f07`, no comments.
  - Performance/reliability: `019f0ef4-2459-7c00-8319-ef6243e032b7`, no
    comments.
- Focused docs re-check `019f0f01-6329-7750-8d07-86e907acec1c` reported no
  comments after the review-round-2 log cleanup.
- Integrated into `main` with merge commit `2fcec21`.

## Integration Result

Merged into `main` as `2fcec21`; post-merge verification passed on the main
checkout with the integration record included.
