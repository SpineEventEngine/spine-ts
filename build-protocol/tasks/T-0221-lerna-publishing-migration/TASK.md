# T-0221: Lerna Publishing Migration

Status: In progress
Start: `2026-08-26 15:23 WEST`
End: Pending
Baseline commit: `af5c897857a85b3736a9efd7490d47faef41b4ac`
Task log path: `build-protocol/tasks/T-0221-lerna-publishing-migration/TASK.md`
Branch: `automated-publishing-and-packaging-improvements`
Worktree: `.worktrees/automated-publishing-and-packaging-improvements`
Authoring sub-agent: existing `implementer` role (`gpt-5.6-terra`, medium)
Reviewer sub-agents: performance/reliability (`gpt-5.6-terra`, high),
style/maintainability (`gpt-5.6-terra`, high), and documentation (`gpt-5.6-luna`,
medium) completed; final security pending
Implementation commits: `59e957f6b`, `461ad8563`, `c1f82e540`, `ad6305205`,
`f2b2257e9`, `88bfb936a`, `f489ad664`, `62d400926`, `c10c0b622`, `c47512859`,
`f24bb88e9`, `fdc645517`, `69376c366`
Current implementation HEAD: `d1d4db98e`; final branch HEAD pending final
security/verification record

Task classification: High-risk
Classification reason: This replaces the OIDC-authorized mutation engine for
18 immutable public packages, changes dependency and recovery behavior, and
deliberately weakens existing artifact-integrity guarantees.

## Estimate

Four to six hours of uninterrupted orchestrated work: 45–75 minutes for
disposable-registry qualification, 60–90 minutes for Lerna and workflow
implementation, 30–45 minutes for version/tag metadata, 45–75 minutes for
focused tests, and 60–90 minutes for parallel review, corrections, and one
final release verification. If qualification reveals a material incompatibility,
stop rather than exceeding eight hours by inventing another publisher.

## Objective

Replace the custom NPM mutation engine with exactly pinned Lerna `10.0.1`
`publish from-package`, while preserving Spine's exact inventory, version,
channel, OIDC, PR isolation, package-content, external-consumer, and final
registry-completeness policies.

## Required Inputs Read

- `AGENTS.md`
- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/PROJECT_COMPLETION_PLAN.md`
- `build-protocol/DECISION_LOG.md` decisions D-0115 and D-0116
- `.planning/2026-08-26-mature-npm-release-tooling-migration/task_plan.md`
- `.planning/2026-08-26-mature-npm-release-tooling-migration/findings.md`
- T-0220 and T-0220a task/work/review records
- Current Lerna 10.0.1 CLI, package metadata, implementation, and official
  publishing/OIDC/pnpm documentation

## Acceptance Criteria

1. Pin `lerna` exactly at `10.0.1`; configure it only for externally versioned
   pnpm-workspace publication. Do not adopt Lerna versioning, changelogs,
   release PRs, Git tags, Nx Release, Nx Cloud, or Nx task execution.
2. Test first with synthetic package names and a disposable local registry.
   Prove private exclusion, exact selection, dependency-first sequential
   publication, snapshot/stable tag selection, interruption, partial rerun,
   fully-published handling, staged contents, clean/detached checkout, and no
   public-registry mutation.
3. Preserve the read-only exact 26-manifest/18-public-package/common-version/
   internal-pin/metadata policy and packed-content, exports, license, README,
   REFERENCE, and external-consumer proof.
4. Remove static `publishConfig.tag` from all 18 public manifests. The exact
   version classifier is the only tag source: `x.y.z-snapshot.N` selects
   `snapshot`, `x.y.z` selects `latest`, and other prereleases fail.
5. The PR workflow remains read-only and has no OIDC or publish capability.
   The official `master` workflow retains an unprivileged verification job and
   a protected GitHub-hosted OIDC job at the exact triggering SHA.
6. The OIDC job runs only pinned Lerna `publish from-package`, from validated
   `.publish` directories, with `--concurrency 1`, `--ignore-scripts`, explicit
   tag, public registry, Git SHA, summary report, and noninteractive confirmation.
   Scoped public access remains in `publishConfig.access`.
7. A read-only registry preflight fails when all 18 versions exist, permits a
   valid partial release, and fails closed on ambiguous registry responses.
   Final verification requires all 18 exact versions and the selected tag.
8. Do not use `--temp-tag` unless a test proves correct partial-run promotion.
   Do not unpublish, overwrite, repair tags separately, configure credentials,
   use tokens, or publish during implementation/testing.
9. The existing custom publisher is unreachable after cutover but remains in
   the repository until one real Lerna release succeeds. Its later deletion is
   a separately versioned cleanup task.
10. Bump all 26 workspace versions to `2.0.0-snapshot.5` in one version-only
    commit with exact message `Bump version -> 2.0.0-snapshot.5`. Update
    concrete internal pins and lockfile only in later separate commits.
11. Focused RED/GREEN evidence, mechanical preflight, relevant specialist
    review, final security review, and one converged `verify:release` pass.

## Human-Imposed Requirements Ledger

- Work on branch `automated-publishing-and-packaging-improvements`; never
  create a `codex/` branch.
- The result may eventually go to the identically named branch in
  `SpineEventEngine/spine-ts`, but do not push any branch or create any PR until
  the human explicitly asks after review.
- Publish after merges reach official `master`; do not use Git tags.
- Use NPM trusted publishing/OIDC only; never introduce an NPM token.
- Publish exactly the 18 framework packages; root and examples remain private.
- Every official merge has one new common package version. A single version-
  only commit may cover all 26 manifests and must use the exact bump message.
- A fully published version fails; a valid partial version resumes.
- Snapshot versions use `snapshot`; stable versions use `latest`; unknown
  prereleases fail.
- Do not enforce agent commit-message rules in CI.
- Use Lerna `10.0.1`; retain pnpm as the package manager.
- Accept loss of exact published-tarball byte identity, integrity-aware resume,
  per-dependency registry-visibility waits, and per-package tag-race checks.
- Keep the old publisher disconnected until one successful real Lerna release;
  clean it up later in a separately versioned change.
- Never publish a real package during implementation or testing.
- Use Standard speed with explicit project model routing; do not use Max or
  Ultra.

## High-Risk Assumptions

- Lerna 10.0.1 `from-package` uses manifest name/version existence for resume,
  not local-to-registry tarball integrity.
- With `npmClient: "pnpm"`, Lerna discovers all entries in
  `pnpm-workspace.yaml`; private flags and Spine's policy reduce the set to 18.
- Lerna 10's stale-upstream versioning check does not execute in
  `from-package`; detached-SHA qualification must prove this remains true.
- All 18 NPM trusted-publisher bindings must match `publish.yml`, the official
  repository and protected environment, and allow the `npm publish` action.
- Static `publishConfig.tag: "snapshot"` would override stable tagging and must
  be removed before cutover.

## Skill Applicability

Skill sources checked:

| Source                                     | Scope Checked                                                                              | Evidence                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Session skill inventory                    | Release planning/execution, TDD, worktrees, monorepo, ADR, verification, and review skills | Desktop session inventory on 2026-08-26                           |
| Task-provided skills                       | No skill explicitly named by the human                                                     | Current conversation                                              |
| `build-protocol/skills/EXPECTED_SKILLS.md` | Complete expected manifest                                                                 | Read before task implementation                                   |
| `~/.agents/skills/*/SKILL.md`              | Full entrypoint inventory                                                                  | `find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md -print` |
| `~/.agents/.skill-lock.json`               | Installed source manifest                                                                  | Readable and checked                                              |

Selected skills read before task actions:

| Skill                           | Source                                                    | Applicability                                  | Instructions Applied                                                                  |
| ------------------------------- | --------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `executing-plans`               | `~/.agents/skills/executing-plans/SKILL.md`               | Execute the approved migration plan            | Review plan first, verify each stage, stop on a real blocker                          |
| `subagent-driven-development`   | `~/.agents/skills/subagent-driven-development/SKILL.md`   | High-risk implementation with child support    | Durable briefs/reports and review gates, subordinate to the project's one-owner cycle |
| `using-git-worktrees`           | `~/.agents/skills/using-git-worktrees/SKILL.md`           | Confirm isolated feature work                  | Existing linked worktree confirmed; no new worktree created                           |
| `test-driven-development`       | `~/.agents/skills/test-driven-development/SKILL.md`       | New release behavior and bug prevention        | RED before production behavior, focused GREEN, refactor only while green              |
| `monorepo-management`           | `~/.agents/skills/monorepo-management/SKILL.md`           | Multi-package publication and dependency graph | Preserve pnpm workspace ownership and test exact package scope/order                  |
| `architecture-decision-records` | `~/.agents/skills/architecture-decision-records/SKILL.md` | Supersede a release-tooling choice             | Record context, alternatives, decision, losses, and migration consequences            |

Skills passed to sub-agents/reviewers:

| Recipient              | Skills/Instructions Passed                        | Notes                                             |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------- |
| Existing `implementer` | TDD, monorepo, ADR summaries and this full ledger | Explicit Terra/medium dispatch; no child spawning |
| Reviewers              | Ledger and concern-specific affected paths        | Explicit repository model routing                 |

Skipped relevant-looking skills:

| Skill                         | Source            | Reason Skipped                                                                                    |
| ----------------------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `planning-with-files`         | Session inventory | Planning is already complete and preserved in `.planning`; this task executes it                  |
| `javascript-testing-patterns` | Session inventory | TDD plus existing Vitest conventions is sufficient; no second testing workflow needed             |
| `security-best-practices`     | Session inventory | Final project security reviewer is the repository's required security gate                        |
| `review`                      | Session inventory | Its generic two-axis diff workflow conflicts with the project's canonical specialist review cycle |

Conflict resolution: the project requires one continuing implementation owner
and one complete specialist review wave, so those rules override the generic
skill's fresh-implementer-per-task and per-task-review cadence. The human's
explicit no-push rule overrides the normal immediate-push protocol.

## Assignment Gate

| Existing role/function             | Bounded ownership                                                                                                    | Explicit model  | Explicit reasoning | Child spawning | Runtime metadata                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------ | -------------- | ------------------------------------------------------------------------------------- |
| `implementer`                      | TDD qualification, dependency/configuration, policy, workflows, docs, task records, focused tests, local commits     | `gpt-5.6-terra` | medium             | Prohibited     | Desktop explicit dispatch fields are authoritative when self-telemetry is unavailable |
| `performance_reliability_reviewer` | Publication ordering, staged artifacts, registry failure/recovery, workflow lifecycle, and bounded-resource behavior | `gpt-5.6-terra` | high               | Prohibited     | Desktop explicit role dispatch fixes the configured profile                           |
| `style_maintainability_reviewer`   | Changed release scripts, tests, Lerna configuration, workflow structure, and maintainability                         | `gpt-5.6-terra` | high               | Prohibited     | Desktop explicit role dispatch fixes the configured profile                           |
| `documentation_reviewer`           | Maintainer runbook, decision record, package/release claims, and accepted-loss wording                               | `gpt-5.6-luna`  | medium             | Prohibited     | Desktop explicit role dispatch fixes the configured profile                           |

## Scope

In scope:

- Lerna qualification and exact dependency/configuration.
- Read-only Spine policy retention and custom mutation disconnection.
- PR and official publish workflow adaptation.
- Version, internal pins, package metadata, lockfile, maintainer documentation,
  task records, tests, reviews, and verification.

Out of scope:

- Public NPM mutation, NPM configuration changes, PR creation, and every push.
- Deleting the old custom publisher before a successful real Lerna release.
- Changesets/Nx Release adoption, broader package/API restructuring, or Wave 15.

## Work Log

- `2026-08-26 15:23 WEST`: Recorded the task, estimate, acceptance criteria,
  human ledger, skill applicability, model routing, and no-push exception before
  implementation.

## Review Dispositions

- Performance/reliability reviewer (`gpt-5.6-terra`, high): affected re-review
  proved Lerna 10.0.1 does not support the prior `--scope` correction. It is
  superseded by an immediately strict-selected disposable workspace containing
  only exact missing package manifests and `.publish` directories; 5xx,
  timeout, malformed data, empty selection, and a fully published release fail
  closed. Residual: Lerna may re-query ambiguously but cannot widen the
  generated inventory.
- Style/maintainability reviewer (`gpt-5.6-terra`, high): accepted identity
  enforcement and owned-test-fixture findings. Public package names must match
  the exact framework inventory; root/examples must be private; staging tests
  now own and clean their temporary directory.
- Documentation reviewer (`gpt-5.6-luna`, medium): accepted runbook wording
  and loss-accounting findings. The runbook names all four accepted losses and
  the aggregate final version/tag verification boundary.
- TypeScript/API documentation review: N/A; this task changes no declarations
  or public TypeScript API.
- Initial review findings and accepted corrections are complete. The initial
  `--scope` correction failed affected re-review because Lerna 10.0.1 does not
  support it; it is explicitly superseded by the generated workspace boundary.
  Current affected re-review of `c47512859` through `69376c366`, final security,
  and final `verify:release` remain pending.

## Decisions

- Add a new accepted decision superseding only D-0115's custom mutation-engine
  details after the Lerna qualification passes. Preserve its trigger, OIDC,
  inventory, version/channel, and PR-isolation decisions.

## Human Questions And Answers

- Blocking questions: none.
- The human explicitly authorized implementation and withheld all push and PR
  authorization until later review.

## Files Changed

- Lerna configuration, policy, workflows, package metadata, lockfile, tests,
  runbook, decision log, and task records; legacy publisher retained unreachable.

## Tests Run

- Focused qualification/release tests and generated-version preflight correction
  passed; final review and `verify:release` remain pending.

## Coverage Result

- Pending final `verify:release`.

## Documentation And Public API Impact

| Area                             | Impact                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| Package README impact            | N/A: package usage does not change                                                           |
| TypeDoc/API docs impact          | N/A: no TypeScript public API changes                                                        |
| Public API additions/removals    | None                                                                                         |
| Framework `USER_GUIDE.md` impact | N/A: contributor release mechanics only                                                      |
| Example `USER_GUIDE.md` impact   | N/A: examples remain private and unchanged except version/pins                               |
| API examples                     | N/A                                                                                          |
| Compatibility notes              | Maintainer release documentation must explain Lerna recovery and deliberate guarantee losses |

## Security Impact

| Area                    | Impact                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| Dependencies            | Adds exact Lerna 10.0.1 and its Nx/npm publication dependency graph |
| Secrets and credentials | OIDC only; no token or credential configuration                     |
| IPC                     | N/A                                                                 |
| Validation              | Retains exact inventory/version/tag and registry-state checks       |
| Tenant boundaries       | N/A                                                                 |
| `Any`/deserialization   | N/A                                                                 |
| Logging                 | Must not expose OIDC material or registry credentials               |

## Verification

- Qualification, cheap preflight, focused tests, and coverage are complete.
  Current affected re-review, final security, and one final `pnpm verify:release`
  remain pending.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up                                          | Owner               | Linked Task/Decision | Disposition                                      | Next Review Point               |
| ------------------------------------------------------- | ------------------- | -------------------- | ------------------------------------------------ | ------------------------------- |
| Exact byte identity and integrity-aware resume are lost | Human/project       | D-0117 pending       | Accepted for migration                           | Reliability and security review |
| Old publisher deletion                                  | Future cleanup task | D-0117 pending       | Deferred until one successful live Lerna release | Post-release cleanup            |
| NPM trusted-publisher allowed actions                   | Human               | T-0221               | Required external configuration                  | Before official merge           |

## Review Waves And Dispositions

Initial review and its accepted corrections are complete; the unsupported
`--scope` attempt is superseded. Current affected re-review covers the isolated
workspace, built-in registry, and audit override commits; final security remains pending.

## Integration Result

Pending local completion and human review. No push is authorized.
