# T-0083: Example documentation and startup

Status: Accepted for integration
Start: `2026-07-31 11:31 WEST`
End: Pending
Baseline commit: `c6f8d79419303b29079b49aad3b4b2ef8ecfc7d1`
Task log path: `build-protocol/tasks/T-0083-example-startup/TASK.md`
Branch: `task/T-0083-example-startup`
Worktree: `.worktrees/T-0083-example-startup`
Authoring sub-agents: `/root/t0083_implement`,
`/root/t0083_lifecycle_finish`
Reviewer sub-agents: `/root/t0083_style_review`,
`/root/t0083_docs_review`, `/root/t0083_api_review`,
`/root/t0083_reliability_review`
Implementation commit: Pending branch commit
Final branch HEAD: Pending branch commit

Task classification: High-risk
Classification reason: The task establishes independently executable server
and browser process contracts, changes startup and shutdown behavior, and must
exercise the authentication/browser gateway topology. It therefore affects
lifecycle ownership and reliability across multiple example modules.

## Objective

Make every example understandable and executable from its documentation. Give
each example one documented startup command, give Chat independent one-command
server and web startup, verify every command in a fresh worktree, and leave the
real Chat server and web UI running for the human to inspect.

## Required Inputs Read

- `AGENTS.md`
- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/PROJECT_COMPLETION_PLAN.md`
- `build-protocol/CODE_QUALITY.md`
- every README and package manifest under `examples/`
- the existing Chat browser interoperability harness and application startup
  paths

## Human-Imposed Requirements Ledger

1. Check the documentation and startup sequence of every example.
2. Start every example directly and repair any code or documentation defect
   that prevents the documented flow.
3. A web-based example must support a standalone Spine TS server process and a
   separate web process.
4. Each web part starts with one npm or pnpm command; users must not assemble
   multi-step generation/build/start pipelines by hand.
5. Documentation must be current, beginner-readable, and copy-paste accurate.
6. Run the final commands and leave the web example and its server running.
7. Report the exact commands and the UI link.
8. Follow the autonomous build protocol through review, verification, commit,
   immediate push, merge to `main`, post-merge verification, and push.
9. Do not build Spine JVM.
10. Do not read, edit, stage, move, delete, or otherwise use either protected
    human-review file.

## Acceptance Criteria

1. Every example family and package has an accurate entry document describing
   prerequisites, generation/build ownership, startup, shutdown, and what a
   successful run looks like.
2. Every non-web example has one package-manager command that starts or runs
   its supported executable demonstration from an installed fresh checkout.
3. Chat has one server command that starts its complete local server-side
   topology and remains alive until interrupted.
4. Chat has one web command that starts its visible React UI independently of
   the server process.
5. The visible Chat UI communicates with the standalone local server rather
   than an in-browser deterministic transport.
6. Startup commands perform or clearly own all required generation/build work;
   they do not depend on stale output from another checkout.
7. Automated tests prove command metadata, readiness, browser/server
   interoperability, useful startup failures, and deterministic shutdown.
8. The orchestrator executes every documented example startup and records the
   observed outcome.
9. Browser verification loads the React UI, exercises a real server-backed
   operation, and finds no unexpected browser-console or server error.
10. Focused checks, documentation checks, generated cleanliness, full
    `pnpm verify`, and at least 90% branch coverage pass.
11. All four canonical review concerns have clean, accepted, or justified N/A
    dispositions.
12. The task branch and merged `main` are pushed and remote equality is
    verified before the final live launch.

## High-Risk Assumptions And Boundaries

- The task may add example-only process entry points and scripts. It must not
  broaden public framework APIs unless existing public APIs cannot support the
  required flow and that limitation is separately recorded.
- The standalone Chat server may compose existing Chat application,
  authentication gateway, and browser transport facilities, but must not
  invent a production deployment or identity-provider policy.
- Development credentials may be deterministic and local-only when clearly
  documented. No secret may be committed or logged.
- Generated Protobuf and handler output remains ignored and uncommitted.
- Docker may remain a prerequisite only if the smallest existing browser
  transport topology genuinely requires it; the requirements analysis must
  prefer a direct supported local topology when available.
- No npm publication and no Spine JVM build is in scope.

## Skill Applicability

Skill sources checked:

| Source                                     | Scope Checked                                                                     | Evidence                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Session skill inventory                    | Task-relevant workflow, testing, debugging, worktree, review, and Node/web skills | Desktop session inventory on 2026-07-31                    |
| Task-provided skill names/paths            | No skill named by the human                                                       | Current request                                            |
| `build-protocol/skills/EXPECTED_SKILLS.md` | Checked                                                                           | Expected workflow skills are installed                     |
| `~/.agents/skills/*/SKILL.md`              | Full entrypoint directory                                                         | Bounded `find` command completed                           |
| `~/.agents/.skill-lock.json`               | Checked                                                                           | Expected source repositories and local entries are present |

Selected skills read before governed task actions:

| Skill                            | Source             | Applicability                                    | Instructions Applied                                                      |
| -------------------------------- | ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `using-git-worktrees`            | `~/.agents/skills` | Isolates write-heavy task work                   | Verified ignore status and created a task worktree                        |
| `implement`                      | `~/.agents/skills` | Implements the approved task                     | Uses test-first focused work and project review gates                     |
| `test-driven-development`        | `~/.agents/skills` | Startup behavior and defects require regressions | Requires observed RED before runtime fixes                                |
| `systematic-debugging`           | `~/.agents/skills` | Existing Chat startup fails in a fresh checkout  | Requires root-cause evidence before correction                            |
| `subagent-driven-development`    | `~/.agents/skills` | One bounded implementation owner and task review | Uses durable project logs instead of removed `.superpowers` scratch state |
| `requesting-code-review`         | `~/.agents/skills` | Required pre-merge review                        | Supplies literal endpoints and a review package                           |
| `verification-before-completion` | `~/.agents/skills` | Required before every success claim              | Requires fresh command evidence                                           |
| `webapp-testing`                 | `~/.agents/skills` | The final React UI must be exercised             | Uses managed servers and headless Chromium after startup                  |

The project protocol overrides two advisory skill instructions: task commits
occur only after protocol review and verification, and no `.superpowers`
directory or ledger will be recreated because the human previously removed
that mechanism. Durable progress lives in this task, work, and review record.

Skipped relevant-looking skills:

| Skill                     | Source                  | Reason Skipped                                                                                            |
| ------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `doc-coauthoring`         | Session inventory       | The human requested autonomous correction, not an interactive writing workflow                            |
| `nodejs-backend-patterns` | Expected-skill manifest | Existing Spine server/auth architecture governs; this task must not introduce a generic backend framework |
| `monorepo-management`     | Session inventory       | Existing pnpm workspace tooling is fixed; no workspace architecture redesign is requested                 |
| `web-quality-audit`       | Session inventory       | The task verifies functionality and documentation, not a full accessibility/SEO/performance audit         |

## Requirements Splitter Dispatch

- Existing role: `requirements_splitter`.
- Scope: audit all example startup contracts and produce the smallest
  dependency-ordered plan for independent Chat server/web processes.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: high.
- Both fields must be explicit in dispatch.
- The child must not spawn subagents, edit files, build Spine JVM, or use the
  protected human-review files.
- Runtime metadata or the immutable configured role/profile and its
  self-introspection limitation must be recorded before accepting the result.

## Requirements Splitter Acceptance

- Result: accepted on 2026-07-31.
- Plan:
  `build-protocol/planning/T-0083_EXAMPLE_STARTUP_PLAN.md`.
- Configured role: `requirements_splitter`.
- Configured model: `gpt-5.6-sol`.
- Configured reasoning: high.
- Dispatch confirmation: model and reasoning were explicit.
- Runtime metadata: the execution surface did not expose separate runtime
  self-metadata. The immutable configured role/profile was confirmed, and this
  limitation does not require redispatch under the project protocol.
- Design outcome: use the existing root generation/build pipeline for
  reproducible package commands; add deterministic signal-owned To-Do
  shutdown; compose Chat backend plus native auth gateway in one local server
  process; connect the separately started React UI directly through Connect
  over loopback HTTP with exact-origin CORS. Keep the Envoy/Docker path as the
  existing HTTPS interoperability reference, not a local startup prerequisite.
- Authorship outcome: one Terra Medium implementer owns the dependency-ordered
  slices serially because manifests, lifecycle code, browser acceptance, and
  documentation form one cross-cutting contract.

## Review Plan

- Style/maintainability: required for new example process composition and
  startup scripts.
- Documentation: required for every example README and command claim.
- TypeScript/API docs: required if authored TypeScript entry points, package
  contracts, or public snippets change.
- Performance/reliability: required for process readiness, shutdown, resource
  ownership, ports, and browser/server topology.
- Security: no separate lane unless implementation changes a framework
  security boundary; existing local authentication behavior must still be
  checked by the relevant reliability/API reviewers.

## Implementation Dispatch

- Existing role: `implementer`.
- Scope: all dependency-ordered slices in
  `build-protocol/planning/T-0083_EXAMPLE_STARTUP_PLAN.md`, with one overlapping
  production-code owner.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: medium.
- Both fields must be explicit in dispatch.
- Selected skills supplied: `implement`, `test-driven-development`,
  `systematic-debugging`, `verification-before-completion`, and
  `webapp-testing`. The implementer must fully read the applicable skill files
  before their governed actions.
- The owner must use observed RED tests before runtime changes, must not spawn
  subagents, commit, push, build Spine JVM, or use protected human-review
  files.
- Runtime metadata or the immutable configured role/profile and its
  self-introspection limitation must be recorded before accepting the result.

## Implementation Result

- Status: complete through focused implementation and verification; review,
  integration, commit, and push remain pending.
- Immutable configured role/profile: `implementer`,
  `gpt-5.6-terra`, medium reasoning.
- Dispatch confirmation: model and reasoning were explicit.
- Runtime self-metadata was unavailable; the immutable configured role/profile
  is the available evidence and is accepted under the protocol.
- Accepted evidence: command-owned preparation, To-Do signal lifecycle,
  exact-origin CORS, and real Chat browser post/read tests pass. Proto
  generation, full generated build, focused suites, formatting, and diff
  integrity pass. Elevated Chromium acceptance starts both documented processes,
  posts and reads a server-backed Projection, records no browser diagnostics,
  and releases both ports.

## Documentation And Public API Impact

| Area                             | Impact                                                  |
| -------------------------------- | ------------------------------------------------------- |
| Package README impact            | All example READMEs are in scope                        |
| TypeDoc/API docs impact          | Example entry points and their TSDoc may change         |
| Public API additions/removals    | None planned                                            |
| Framework `USER_GUIDE.md` impact | Update only if it links to or describes example startup |
| Example `USER_GUIDE.md` impact   | Update each affected example guide when present         |
| API examples                     | Startup and browser usage snippets are in scope         |
| Compatibility notes              | No serialized or JVM compatibility change planned       |

## Security Impact

| Area                    | Impact                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| Dependencies            | No new dependency planned                                           |
| Secrets and credentials | Local development auth must use documented non-secret fixtures      |
| IPC                     | Existing local topology may be exercised; no new trust claim        |
| Validation              | Existing framework validation remains unchanged                     |
| Tenant boundaries       | Chat startup must preserve the existing tenant/actor context        |
| `Any`/deserialization   | Existing generated registry behavior remains unchanged              |
| Logging                 | Startup output must not print credentials or sensitive session data |

## Verification

- `pnpm install --frozen-lockfile`: passed, 22 workspace projects.
- `pnpm proto:generate`: passed, 40 source checksums and 49 frozen descriptors.
- Focused elevated startup/lifecycle/browser verification: passed.
- Elevated `pnpm --dir examples/chat/web test:browser --project=chromium`:
  passed, 1 real gateway/browser test in 43 seconds.
- Documented Projects, Orders, To-Do, Chat server, and Chat web commands:
  passed in a fresh task worktree.
- Final `pnpm verify`: passed, 166 test files / 3,231 tests, 90.04% branch
  coverage (`10,199/11,326`), TypeDoc export verification, Proto freshness, and
  release readiness.

## Review Waves And Dispositions

Converged:

- Style/maintainability: clean after semantic-owner, lifecycle, test, and TSDoc
  corrections.
- Documentation: accepted after prerequisites and topology wording corrections.
- TypeScript/API docs: clean; new seams remain internal and documented.
- Performance/reliability: clean after rollback, timeout/retry, signal,
  active-listener, port-release, and fixed-port-race corrections.
- No P0/P1/P2 remains.

## Integration Result

Pending.
