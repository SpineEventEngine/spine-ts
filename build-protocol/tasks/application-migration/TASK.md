# Application migration — planning stage

- Request: analyze core-jvm PRs #1717 and #1720 and the latest Spine TS master;
  deliver beginner-readable, copyable Markdown with before/after examples,
  useful diagrams, options, and a final numbered questions/recommendations list.
- No documentation skills are permitted. The initially invoked skill was
  stopped following the user's correction; no further workflow from it applies.
- Baseline: freshly fetched `origin/master`,
  `3844fd36953beefdd655fad5cf6f83b7fa75e2c6`.
- Worktree: `/Users/armiol/.codex/worktrees/application-api-plan/spine-ts`.
- Branch: `application-migration`. This is the first stage of the migration; no runtime implementation,
  release/version changes, PR, or integration into master is part of this initial deliverable.
- Classification: standard planning/document change; the proposed future runtime
  work is high-risk because it changes public APIs and lifecycle responsibilities.
- Acceptance: distinguish both JVM PR stages; trace all TS singleton consumers;
  cover tenant registration, storage creation/checking, lazy preparation,
  application construction, server startup/shutdown, tests, and migration.
  Clearly label proposed APIs. Complete a standalone review without chat history
  after the document is drafted, and address findings in the document.
- Verification: cheap Markdown/source-reference checks before review;
  `pnpm verify:task -- --no-tests` after convergence. No runtime tests are added
  for this analysis-only change. Current master evidence can supply baseline
  runtime coverage; this task does not claim a new runtime test result.
- Surface gate: desktop supports explicit child model/reasoning dispatch;
  Standard speed, no Fast/boost, no Max/Ultra.
- Architecture dispatch: existing `requirements_splitter`, explicitly
  `gpt-6-astra`, `high`, `fork_turns=none`; read-only JVM/API architecture analysis.
  Both model fields were explicit. Configured role is immutable; actual
  runtime metadata was not exposed. No nested subagents.
- Reviewer dispatches and results: complete; findings and resolutions recorded below.
- Review dispositions: style N/A (no production structure changes); documentation,
  TypeScript/API, and reliability claims accepted after review; security N/A (analysis
  only, no security implementation or release-readiness claim).
- Current status: planning stage complete, reviewed, and verified; runtime migration remains the next stage.

- Latest JVM reference: cloned official `core-jvm/master` at `a108f30a896efa63c6ba901c245ee587e7944344`, including the subsequent multiTenant rename. Every document point must compare JVM behavior and explain any TS difference.
- Skill inventory: exposed session catalog and `build-protocol/skills/EXPECTED_SKILLS.md` inspected; `rg --files ~/.agents/skills -g SKILL.md` found 47 entries; installed lock is readable. Worktree skill applied. Documentation-writing skills prohibited. No skill installation. Other implementation/review workflow skills skipped because the project protocol supplies the required workflow for this planning stage.
- Architecture result: explicit configured requirements_splitter/Astra/high accepted; runtime self-introspection unavailable. Initial pass used PR head; latest-master comparison completed before acceptance of its source claims.

## Review dispatch and preflight

- Latest-master architecture continuation accepted: same requirements_splitter,
  explicit Astra/high profile; actual runtime metadata unavailable. Compared the
  pinned JVM master to PR #1720 and confirmed lifecycle facts plus #1723 naming.
- Draft complete: `PLAN.md`; each of 16 migration points states JVM behavior and
  TS same/different rationale. Questions and recommendations are at the end.
- Cheap preflight passed: changed-file Prettier, `git diff --check`,
  `docs:audience:check`, 23 pinned source paths, final-question placement, and
  actual Mermaid parse of all 6 diagrams. No changed production files, so
  affected runtime coverage and typechecks are N/A for the draft.
- Standalone review wave: each child gets `fork_turns=none`, explicit profile,
  read-only source/document paths, user-requirement ledger, and no prior chat.
  No reviewer may use documentation-writing skills or spawn another agent.
- Existing `documentation_reviewer`: expected `gpt-6-luna`, `medium`;
  comprehension, completeness, examples, diagrams, final questions.
- Existing `typescript_api_docs_reviewer`: expected `gpt-6-sol`, `medium`;
  latest JVM factual accuracy, current TS claims, proposed public API coherence.
- Existing `performance_reliability_reviewer`: expected `gpt-6-sol`, `medium`;
  lifecycle, storage preparation, tenant checks, concurrency, cleanup claims.
- All model/reasoning fields are explicit in dispatch. Configured role/profile
  accepted when actual runtime metadata is not exposed; visible mismatch would
  require redispatch. The complete wave was collected before corrections.

## Review results and corrections

All three standalone reviewers used no inherited chat history. Explicit configured
profiles matched the assignments; runtime self-introspection was unavailable.
The existing immutable role/profile is the acceptance evidence. No nested agents.

| Concern              | Finding                                                      | Resolution in PLAN.md                                                                           |
| -------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Reader comprehension | Undefined System Context, Stand, Inbox and route terminology | Plain definitions in point 1                                                                    |
| Reader comprehension | Validation example never builds                              | Awaited failing build in point 4                                                                |
| API                  | ThirdPartyContext attachment states unclear                  | Exact JVM states, pre-attachment close no-op, point 13                                          |
| API                  | Exported build-options type omitted                          | ApplicationBuildOptions replaces public BoundedContextBuildOptions, point 9                     |
| API                  | Server extra-resource cleanup omitted                        | Per-server resource and failed-start contracts, point 10                                        |
| API                  | Third-party factory rename omitted                           | Both public multiTenant factories, point 13                                                     |
| Reliability          | Concurrent asynchronous builds can overlap                   | Synchronous builder/environment reservation before await, point 3                               |
| Reliability          | Listener draining closes shared Bounded Contexts             | Endpoint-only drain, no shared beginClose/Delivery drain, point 10                              |
| Reliability          | Default index check could create structures                  | Separate no-create handle, operation modes, retry and close during initialization, points 5/7/8 |
| Reliability          | Managed callback can fail before returning a handle          | Callback cleans Application on rejection, point 14 and question 9                               |
| Reliability          | Application close versus starting/active endpoints ambiguous | Caller closes endpoints, start fencing/rollback before resource teardown, point 11              |

- All 11 findings accepted and addressed in document text; none waived.
- Focused API recheck accepted all corrected contracts, including explicit removal
  of public BoundedContext.tenantIndex in favor of Application access.
- Focused reliability recheck accepted all five corrections; no residual findings.
- Documentation corrections were deterministic and did not require another lane.
- Canonical dispositions: documentation accepted; TypeScript/API accepted;
  performance/reliability accepted; style N/A (no production structure changes);
  security N/A (no implementation or release-readiness claim).
- Selected final gate: `pnpm verify:task -- --no-tests`, all-Markdown change set.
  Runtime implementation, provider behavior tests, and release/version-only
  commit remain future migration work, described in PLAN.md.
- Final verification: PASS, `pnpm verify:task -- --no-tests` (exit 0).

- First final-gate attempt passed build/tooling typechecks, then ESLint detected the ignored temporary `.analysis/diagram-check/check.mjs` helper (`URL`/`console` lint globals). No tracked runtime or plan defect. Renamed the already-successful helper to `.txt` outside the lint input extension set. Re-ran changed-file formatting, document policy, source/snippet/diagram checks as applicable, and whitespace preflight before the justified second gate attempt.

- Second gate passed compilation, lint, format, and documentation policy, then release-readiness recursively scanned the research checkout despite Git ignore and rejected upstream JVM Markdown. Moved all research to sibling `../application-migration-research/` outside the TS repository, retaining the official clone at `../application-migration-research/core-jvm`. No project checker was weakened and no upstream source was changed. Targeted readiness and complete cheap preflight run before the final retry.

## Accepted planning-stage result

- Final profile passed: build/typechecks, ESLint, cleanup/TSDoc/copyright/time/log
  checks, repository formatting, documentation policy, and readiness checks.
- Readiness checked 133 package imports, 67 assets, and 646 relative Markdown links.
- Document checks passed: 16 explicit JVM comparisons, 23 pinned source paths,
  6 parsed Mermaid diagrams, 15 parsed TypeScript examples, 13 numbered questions
  with recommendations at the end. Proposed APIs were syntax-checked, not claimed
  to typecheck against the unchanged current exports.
- No runtime tests or coverage run was claimed for this all-Markdown stage.
- All architecture/review participants completed. All 11 accepted findings are
  resolved; no remaining review findings. No runtime implementation, version
  change, pull request, or master integration occurred.
- Verification log retained locally at
  `../application-migration-research/verify-task-passed.log`.
- Planning-stage files are committed and immediately pushed to official origin
  on `application-migration`; the final chat records the successful endpoint.
- Next stage: use the final questions to settle the necessary TS adaptations,
  then implement the ordered migration slices. The future merge-ready branch
  still requires its version-only commit and runtime release verification.
