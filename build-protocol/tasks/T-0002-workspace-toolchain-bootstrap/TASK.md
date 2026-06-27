# T-0002: Workspace And Toolchain Bootstrap

Status: Ready for review round 3
Start: `2026-06-27 17:27 WEST`
End: `2026-06-27 19:45 WEST`
Baseline commit: `0566998`
Task log path: `build-protocol/tasks/T-0002-workspace-toolchain-bootstrap/TASK.md`
Branch: `task/T-0002-toolchain`
Worktree: `.worktrees/T-0002-toolchain`
Authoring sub-agent: Codex implementation sub-agent, senior TypeScript/Node platform engineer persona
Reviewer sub-agents: Review rounds 1 and 2 recorded in `build-protocol/reviews/T-0002-workspace-toolchain-bootstrap.md`
Implementation commit: `a937649`
Review round 1 fix commit: `a0638218ec2b5caa786f958333a00af6a9fcbf4c`
Review round 1 handoff evidence commit: `ee611a203ee40387b4ffb09451489d25c98cb01b`
Active reviewed state convention: the review round 2 fix/evidence-log successor follows `ee611a203ee40387b4ffb09451489d25c98cb01b`; because a commit cannot embed its own hash before it exists, recovery must verify the actual branch tip with `git rev-parse HEAD` and rerun recorded checks against `main...HEAD`.

## Objective

Create the initial TypeScript/Node.js monorepo foundation for the Spine TS framework without implementing runtime behavior.

## Required Inputs Read

- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `build-protocol/CONTRIBUTOR_WORKFLOW.md`
- `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling` from T-0003
- `build-protocol/skills/EXPECTED_SKILLS.md`
- `build-protocol/templates/TASK_LOG_TEMPLATE.md`
- `build-protocol/templates/REVIEW_LOG_TEMPLATE.md`
- Advisory sub-agent recommendations for tooling choices, when complete.

## Skill Applicability

Canonical checklist source: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`, merged from main at `6f8cd3c`.

Skill sources checked:

| Source                                     | Scope Checked                                    | Evidence                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session skill inventory                    | Task-relevant subset available in session prompt | Relevant visible session skills included `back-merge-review`, `security-best-practices`, `security-threat-model`, `openai-docs`, and repo/product planning skills. None directly replaced the installed-skill workflow selected below.                                                  |
| Task-provided skill names/paths            | Prompt-provided likely skills                    | User prompt named `monorepo-management`, `nodejs-backend-patterns`, `typescript-advanced-types`, `javascript-testing-patterns`, `architecture-decision-records`, `using-git-worktrees`, `verification-before-completion`, `receiving-code-review`, and allowed other applicable skills. |
| `build-protocol/skills/EXPECTED_SKILLS.md` | Full expected manifest                           | Checked after merging T-0003. Manifest expects `subagent-driven-development`, `using-git-worktrees`, `requesting-code-review`, `verification-before-completion`, `planning-with-files`, `architecture-decision-records`, `typescript-advanced-types`, and `nodejs-backend-patterns`.    |
| `~/.agents/skills/*/SKILL.md`              | Full directory, bounded to max depth 2           | `find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md -print` found the expected skills plus relevant extras including `monorepo-management`, `javascript-testing-patterns`, `receiving-code-review`, and `resolving-merge-conflicts`.                                              |
| `~/.agents/.skill-lock.json`               | Checked                                          | Lock manifest was readable; relevant entries came from `obra/superpowers`, `wshobson/agents`, `othmanadi/planning-with-files`, and `mattpocock/skills`.                                                                                                                                 |

Selected skills read before governed actions:

| Skill                            | Source                                                     | Applicability                                                                    | Instructions Applied                                                                                                             |
| -------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `using-git-worktrees`            | `~/.agents/skills/using-git-worktrees/SKILL.md`            | Work is in an assigned linked worktree.                                          | Verified existing worktree instead of creating another; preserved isolation on branch `task/T-0002-toolchain`.                   |
| `resolving-merge-conflicts`      | `~/.agents/skills/resolving-merge-conflicts/SKILL.md`      | Stash restore created a decision-log conflict.                                   | Inspected current state and conflict sources, preserved both T-0003 and T-0002 decision intent, and renumbered T-0002 decisions. |
| `monorepo-management`            | `~/.agents/skills/monorepo-management/SKILL.md`            | T-0002 creates the initial pnpm monorepo skeleton.                               | Applied pnpm workspace, centralized configs, package READMEs, and avoided Nx/Turbo until useful.                                 |
| `nodejs-backend-patterns`        | `~/.agents/skills/nodejs-backend-patterns/SKILL.md`        | Framework is Node backend infrastructure, but runtime services are out of scope. | Applied Node/TypeScript, validation/security awareness, and deferred server/runtime dependencies.                                |
| `typescript-advanced-types`      | `~/.agents/skills/typescript-advanced-types/SKILL.md`      | Strict TypeScript library package setup.                                         | Applied strict settings and explicit public skeleton types without complex type machinery.                                       |
| `javascript-testing-patterns`    | `~/.agents/skills/javascript-testing-patterns/SKILL.md`    | T-0002 configures Vitest and coverage.                                           | Applied Vitest with V8 coverage and small skeleton tests; deeper testing references not needed for non-runtime code.             |
| `architecture-decision-records`  | `~/.agents/skills/architecture-decision-records/SKILL.md`  | Tooling decisions must be recorded durably.                                      | Recorded context, decision, alternatives, and consequences in `DECISION_LOG.md`.                                                 |
| `verification-before-completion` | `~/.agents/skills/verification-before-completion/SKILL.md` | Required before claiming or committing passing work.                             | Will run fresh install and verification commands before commit/final status.                                                     |
| `subagent-driven-development`    | `~/.agents/skills/subagent-driven-development/SKILL.md`    | T-0002 is executed by an implementation sub-agent under the repo review loop.    | Applied durable progress logging and review-loop awareness; no new sub-subagents spawned from this implementation role.          |
| `requesting-code-review`         | `~/.agents/skills/requesting-code-review/SKILL.md`         | Branch must be handed off ready for review round 1.                              | Final handoff will report commit/diff basis and verification for reviewer dispatch.                                              |
| `receiving-code-review`          | `~/.agents/skills/receiving-code-review/SKILL.md`          | Future review feedback must be evaluated rigorously.                             | Recorded for review loop readiness; no reviewer findings have been received yet.                                                 |

Skills passed to sub-agents/reviewers:

| Recipient        | Skills/Instructions Passed                                                                       | Notes                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| T-0002 reviewers | `BUILD_PROTOCOL.md#skills-and-tooling`, `EXPECTED_SKILLS.md`, selected skills above by name/path | Reviewers must run their own skill applicability gates per T-0003. |

Skipped relevant-looking skills:

| Skill                                                                                                                                      | Source                                                              | Reason Skipped                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `planning-with-files`                                                                                                                      | Expected manifest / `~/.agents/skills/planning-with-files/SKILL.md` | T-0002 already has a concrete task log and no separate plan-file decomposition is being authored in this turn.                           |
| `test-driven-development` / `tdd`                                                                                                          | Installed skill directory                                           | T-0002 is scaffolding/configuration work; skeleton tests were added for gates, but no runtime behavior is being test-driven.             |
| `architecture-patterns`, `api-design-principles`, `cqrs-implementation`, `projection-patterns`, `event-store-design`, `saga-orchestration` | Installed skill directory metadata                                  | These are relevant to later runtime/domain tasks but out of scope for bootstrap-only package skeletons.                                  |
| `security-best-practices`, `security-threat-model`                                                                                         | Session skill inventory                                             | No explicit security review/threat-model request in this implementation turn; security impact is recorded in the task log for reviewers. |

Conflict resolution: installed skills are advisory. Repository protocol, task scope, sandbox/approval rules, and explicit user instructions remain authoritative.

## Scope

In scope:

- Record current tooling investigation and decisions.
- Select package manager, TypeScript, module target, lint/format, test/coverage, TypeDoc, Buf, and Protobuf-ES tooling.
- Initialize workspace package metadata and strict TypeScript configuration.
- Add package skeleton boundaries matching the specification.
- Add package-level README placeholders and framework/example `USER_GUIDE.md` placeholders.
- Add local scripts for type checking, linting, formatting, tests, coverage, docs, and protobuf generation stubs where feasible.
- Keep implementation behavior intentionally skeletal.

Out of scope:

- Copying Spine proto files.
- Implementing runtime buses, entities, storage, validation, or ZeroMQ transport.
- Implementing the to-do domain.
- Adding gRPC or ZeroMQ runtime code beyond documented dependency decisions or deferrals.

## Work Log

- `2026-06-27 17:27 WEST`: Main orchestrator created T-0002 worktree and initial task/work logs before implementation edits.
- `2026-06-27 17:27 WEST`: Spawned advisory agents for package/workspace tooling, test/docs tooling, and protobuf/platform tooling.
- `2026-06-27 18:05 WEST`: Authoring sub-agent read all required protocol/spec/task/log/decision documents before implementation edits.
- `2026-06-27 18:12 WEST`: Recorded advisory decisions for pnpm, TypeScript, ESLint/Prettier, Vitest/coverage, TypeDoc, Buf/Protobuf-ES, deferred validation/gRPC/ZeroMQ, and non-blocking skill-installer failure.
- `2026-06-27 18:20 WEST`: Added root workspace configuration, package/example skeletons, docs placeholders, tooling configs, and proto workflow stubs.
- `2026-06-27 18:45 WEST`: Resumed after user pause; confirmed host tools as Node `v24.18.0`, corepack `0.35.0`, and pnpm `11.9.0`.
- `2026-06-27 18:50 WEST`: Stashed uncommitted T-0002 scaffold edits, fast-forward merged main at `6f8cd3c` for T-0003 protocol docs, restored stash, and resolved `DECISION_LOG.md` conflict by preserving T-0003 D-0019 and renumbering T-0002 decisions.
- `2026-06-27 19:05 WEST`: Ran and recorded the T-0003 canonical skill applicability gate for T-0002.
- `2026-06-27 19:20 WEST`: Installed dependencies with pnpm 11.9.0 after recording a release-age policy exception for explicit fresh pins and approving only `@bufbuild/buf` build scripts.
- `2026-06-27 19:35 WEST`: Ran full verification successfully: typecheck, lint, format check, tests, coverage, TypeDoc, proto lint stub, and proto generate stub.
- `2026-06-27 19:45 WEST`: Committed implementation as `a937649`, dropped temporary pre-merge stash, and prepared branch for review round 1.
- `2026-06-27 19:55 WEST`: Verified T-0002 review round 1 findings against the repo and applied focused fixes for durable HEAD/current-state logging, pnpm freshness policy removal, local path redaction, durable formatting globs, and Node baseline enforcement.
- `2026-06-27 19:58 WEST`: Ran review-fix verification: full verify, whitespace check, engine-strict check, absolute-local-path search, and repo-default freshness-bypass search all passed.
- `2026-06-27 20:11 WEST`: Verified T-0002 review round 2 findings, reproduced the missing tooling/test TS typecheck, added durable review evidence, adopted the evidence-log successor wording, and fixed no-emit typechecking for tests/config/tooling TS.
- `2026-06-27 20:14 WEST`: Ran round 2 fix verification: `CI=true pnpm verify`, standalone tooling TS typecheck, diff whitespace check, reviewer-state search, review-evidence link search, and recovery-wording search all passed.

## Decisions

- `D-0019`: T-0003 user-installed skills protocol, merged from main.
- `D-0020`: pnpm workspaces, TypeScript project references, Node 24 LTS minimum, and no Nx/Turbo initially.
- `D-0021`: TypeScript 6.0.3, ESM-first NodeNext, strict settings, with TypeScript 5.9 fallback noted if compatibility fails later.
- `D-0022`: ESLint flat config, `typescript-eslint@8.62.0`, Prettier 3.9.0, Vitest 4.1.9 with V8 coverage, and TypeDoc 0.28.19 native HTML.
- `D-0023`: Buf/Protobuf-ES package pins and v2 config stubs; no Spine proto files copied in T-0002.
- `D-0024`: Deferred validation-ts, Connect/gRPC, and ZeroMQ installation; recorded non-blocking skill-installer HTTP 401.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: package manager, test/coverage stack, docs tooling, Buf/Protobuf-ES setup, gRPC/ZeroMQ dependency timing are being handled through advisory sub-agents.

## Files Changed

- `.gitignore`
- `.npmrc`
- `.node-version`
- `.prettierignore`
- `.prettierrc.json`
- `README.md`
- `buf.gen.yaml`
- `buf.yaml`
- `eslint.config.mjs`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `tsconfig.eslint.json`
- `tsconfig.json`
- `typedoc.json`
- `build-protocol/reviews/T-0002-workspace-toolchain-bootstrap.md`
- `vitest.config.ts`
- `scripts/proto-workflow.mjs`
- `scripts/check-node-version.mjs`
- `proto/README.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `packages/proto/**`
- `packages/core/**`
- `packages/server/**`
- `packages/transport/**`
- `packages/storage/**`
- `packages/testing/**`
- `examples/todo/**`
- `build-protocol/DECISION_LOG.md`
- `build-protocol/tasks/T-0002-workspace-toolchain-bootstrap/TASK.md`
- `build-protocol/work-logs/T-0002.md`

## Tests Run

- `pnpm install` - initially failed because pnpm refused to purge an interrupted `node_modules` directory without a TTY.
- `CI=true pnpm install` - initially failed active minimum-release-age policy for explicit fresh pins `prettier@3.9.0` and transient `js-yaml@4.3.0`.
- `CI=true pnpm install --config.minimum-release-age=0` - one-time lockfile creation exception; resolved dependencies, then failed until `@bufbuild/buf` build script was explicitly approved.
- `pnpm approve-builds @bufbuild/buf` - passed; only Buf's postinstall was approved.
- `CI=true pnpm install` - passed after moving pnpm settings into `pnpm-workspace.yaml`.
- `CI=true pnpm lint` - passed after scoping type-aware TypeScript ESLint rules to `.ts` files.
- `CI=true pnpm proto:lint` - passed; no `.proto` files found, Buf lint deferred until proto intake.
- `CI=true pnpm proto:generate` - passed; no `.proto` files found, Buf generation deferred until proto intake.
- `CI=true pnpm verify` - passed.
- Review round 1 fix verification: `CI=true pnpm verify` - passed with `check:node` running first.
- `pnpm exec tsc --noEmit -p tsconfig.eslint.json` - initially failed on missing ambient types and invalid `coverage.all`; passed after round 2 fixes.
- `pnpm add -Dw @types/node@24.13.2 --config.minimum-release-age=0` - one-time lockfile update exception; repo defaults still do not carry a freshness bypass.
- Review round 2 fix verification: `CI=true pnpm verify` - passed with `typecheck:tooling` included in `pnpm typecheck`.

## Coverage Result

- `CI=true pnpm verify` ran `vitest run --coverage --passWithNoTests`.
- Coverage summary: statements 100% (7/7), branches 100% (0/0), functions 100% (0/0), lines 100% (7/7).
- Coverage is meaningful only for metadata-only skeleton exports in T-0002; runtime coverage must be added by later behavior tasks.

## Documentation And Public API Impact

| Area                             | Impact                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package README impact            | Added placeholder READMEs for all six package skeletons and the to-do example.                                                                                   |
| TypeDoc/API docs impact          | Added `typedoc.json`, `docs/api/README.md`, and `docs:api`/`docs:check`; TypeDoc HTML generation passes with one source-link warning due invalid local `origin`. |
| Public API additions/removals    | Added metadata-only skeleton exports for package/example entrypoints; no runtime API behavior.                                                                   |
| Framework `USER_GUIDE.md` impact | Added `docs/USER_GUIDE.md` placeholder explaining current bootstrap status and deferred runtime behavior.                                                        |
| Example `USER_GUIDE.md` impact   | Added `examples/todo/USER_GUIDE.md` placeholder; no runnable to-do domain yet.                                                                                   |
| API examples                     | Deferred with reason; behavior examples would be misleading before runtime APIs exist.                                                                           |
| Compatibility notes              | Documented no Spine proto files copied in this task and proto intake/generation are deferred.                                                                    |

Initial implementation note: package/example exports are metadata-only skeleton constants and types so TypeScript, TypeDoc, and coverage gates have visible entry points without implementing framework behavior.

## Security Impact

| Area                    | Impact                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependencies            | Added dev/runtime package pins and lockfile; used one-time release-age install exceptions for explicit fresh pins and approved only `@bufbuild/buf` build script. |
| Secrets and credentials | N/A; no secrets introduced.                                                                                                                                       |
| IPC                     | Deferred; ZeroMQ runtime code and dependency installation are out of scope.                                                                                       |
| Validation              | Deferred; `@spine-event-engine/validation-ts` intentionally not installed in T-0002.                                                                              |
| Tenant boundaries       | Deferred; no runtime tenant implementation.                                                                                                                       |
| `Any`/deserialization   | Deferred; no Protobuf runtime behavior implemented.                                                                                                               |
| Logging                 | N/A; no runtime logging implementation.                                                                                                                           |

Redaction rule: record enough context for auditability, but never commit tokens, credentials, auth headers, secret environment variables, sensitive local paths, or sensitive payloads.

## Verification

- Host toolchain checked: Node `v24.18.0`, corepack `0.35.0`, pnpm `11.9.0`.
- `CI=true pnpm verify` - passed.
- `pnpm exec tsc --noEmit -p tsconfig.eslint.json` - passed after round 2 fixes; covers tests/config/tooling TS.
- `git diff --check main...HEAD` - passed after commit.
- Reviewer state search - passed; task log no longer says reviewer sub-agents are pending.
- Review evidence link search - passed; task log links `build-protocol/reviews/T-0002-workspace-toolchain-bootstrap.md`.
- Recovery wording search - passed; no stale moving-head wording remains in T-0002 task/work/review logs.
- `pnpm config get engine-strict` - returned `true`.
- Search for absolute local paths in T-0002 changed docs/logs - passed; no sensitive home-directory paths remain.
- Search for repo-default `minimum-release-age=0` / `minimumReleaseAge: 0` - passed; no freshness bypass remains in repo default package manager config.
- TypeDoc warning reviewed: invalid local `origin` remote means source links are broken, but docs generation reports 0 errors and writes `docs/api/reference` (ignored).
- Proto commands reviewed: both pass with explicit deferred behavior while `proto/` has no `.proto` files.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up                                                                                    | Owner                   | Linked Task/Decision | Disposition                                                                              | Next Review Point                      |
| ------------------------------------------------------------------------------------------------- | ----------------------- | -------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------- |
| Tooling choices may need current registry/network checks.                                         | T-0002 author           | T-0002 decisions     | Addressed by pnpm install and lockfile                                                   | T-0002 review round 1                  |
| Coverage may be N/A or minimal for skeleton-only package setup.                                   | T-0002 author           | T-0002 task log      | Addressed for skeleton exports; runtime coverage deferred                                | T-0002 review round 1                  |
| Earlier local environment reported Node `v22.2.0`, below the configured Node 24 LTS minimum.      | T-0002 author           | D-0020               | Resolved by host update to Node `v24.18.0`                                               | Verification and T-0002 review round 1 |
| Earlier local shell lacked Corepack while the package manager decision targets pnpm via Corepack. | T-0002 author           | D-0020               | Resolved by host update to corepack `0.35.0` and pnpm `11.9.0`                           | Verification and T-0002 review round 1 |
| A repo-local freshness bypass would weaken pnpm's supply-chain delay for future installs.         | T-0002 author           | D-0020               | Addressed in review round 1 by removing checked-in `minimumReleaseAge: 0` defaults       | T-0002 review round 2                  |
| Tests/config/tooling TypeScript could drift outside package project references.                   | T-0002 author           | D-0022               | Addressed in review round 2 with `typecheck:tooling` and Node/Vitest/Web ambient types   | T-0002 review round 3                  |
| TypeDoc source links are broken because the local `origin` remote is invalid.                     | Future repository owner | D-0022               | Accepted warning for bootstrap; docs generation has 0 errors                             | T-0002 review round 1                  |
| Git kept the pre-merge stash after conflict resolution.                                           | T-0002 author           | T-0002 work log      | Resolved; dropped temporary stash after implementation commit                            | T-0002 review round 1                  |
| Future verification should fail under Node 22 rather than warn only.                              | T-0002 author           | D-0020               | Addressed in review round 1 with `engine-strict=true`, `.node-version`, and `check:node` | T-0002 review round 2                  |

## Review Rounds

- Review rounds 1 and 2 returned important findings; dispositions are recorded in `build-protocol/reviews/T-0002-workspace-toolchain-bootstrap.md`.

## Integration Result

Not integrated. Branch is ready for review round 3 only.
