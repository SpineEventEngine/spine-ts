# Cross-context queries work log

Started: 28 September 2026. Status: implementation in progress.
Task/branch: `cross-context-queries`.
Worktree: `/Users/armiol/.codex/worktrees/cross-context-queries/spine-ts`.
Base: `2324311be8c23024f66cb2ba702fbe99a99e7dfb` from freshly fetched official origin.
Main checkout is clean master; native worktree is attached to this same chat.

## Framing and skills

Read current BUILD_PROTOCOL completely and CODE_QUALITY, current completion-plan
workflow and blocker sections, and expected-skill manifest. Session catalog is
the skill source; readable installed entrypoints listed with rg and installed
lock inspected at `/Users/armiol/.agents/.skill-lock.json`. Full selected skills:
implement, test-driven-development, using-git-worktrees and
subagent-driven-development (including dispatch templates). Existing approved
plan and prior skill evidence remain available; no duplicate architecture pass.
Review and verification skills will be read before their phases.

Protocol takes precedence over advisory skill defaults: reuse the implementer
for fixes, use repository logs rather than a duplicate hidden ledger, explicit
project profiles, no redundant baseline full test run, and no automatic PR/merge.
Unavailable writing-plans/finishing-branch skills are replaced by the reviewed
plan and project completion workflow. No new generic infrastructure or library
is selected: reuse existing query/storage/bus APIs and built-in Map.

Desktop exposes explicit required model profiles. All dispatch fields are
explicit; actual runtime metadata is not separately exposed. Accept immutable
role configuration unless a mismatch is reported. Standard speed only.

## Assignments recorded before dispatch

- Existing implementer: gpt-6-sol / medium; sole production/test/example writer,
  narrow behavior tests first, no broad release gate, no child dispatch.
- Mechanical workspace preparation: orchestrator-dispatched function using
  gpt-6-luna / low; install frozen dependencies and generate/build prerequisites,
  no tracked source changes, no children or broad tests.
- Review profiles and scope are recorded in the plan; record exact dispatches
  and evidence in the review log before review begins.

## Verification strategy

No full baseline rerun. Focused tests use one Vitest worker and no watch mode.
Preflight includes changed formatting, whitespace, affected typechecks/tests,
cleanup/TSDoc/doc checks and changed-production coverage inspection.
Shared runtime/lifecycle/tenant changes require one converged verify:release.
Build CI runs only for PRs; do not claim a green branch build without a run at
the exact final SHA. PR creation remains reserved for the human.

## Progress

Approved requirements and reviewed lifecycle corrections recorded before code.
Assignments dispatched explicitly: cross_context_setup uses Luna/low;
cross_context_implementation uses the existing implementer, Sol/medium. No
runtime profile mismatch reported. Both children are prohibited from spawning.

Official master Publish run 36447296300 passed at the exact baseline SHA.
There is no open PR for this branch. Registry reads confirmed snapshot.17 is
unused for all 19 publishable packages; this is the candidate common version.
No registry writes were performed. Frozen install succeeded with missing CLI
bin warnings before fresh dist generation; generation/build prerequisites are
in progress. The implementer waits for build completion before production edits.

Architecture-decision-records guidance was read for the existing decision-log
entry; reuse this project's record format, with no new ADR tooling or directory.

Preparation completed: frozen install, Proto generation and TypeScript build
passed. The setup child reverted only its generated tracked-manifest changes;
main records and the implementer's test remain. Record formatting, whitespace
and document audience checks passed. Plan checkpoint b2b6f9f98 was pushed to
origin immediately. No PR was created.

Initial cross-context failure was timing-ambiguous because Server delivery is
asynchronous. The corrected test waits for completion. Conclusive RED/GREEN:
temporarily restoring only the original local Stand query call fails with
StandStateTypeError for ProjectOverviewState; restoring routing passes 1/1.
Next RED confirms named-tenant to single-tenant rejection occurs after QueryReader
is entered; the correction must reject before any read. Full output is retained
in the implementation report under the task's temporary evidence directory.

CLI dist exists after build. A frozen reinstall completed without warnings but
did not recreate the two workspace CLI shims; no shim repair is claimed. No
current focused test depends on them. Check actual final verification needs
before expanding setup work.

Read-only documentation inventory assignment, before dispatch: existing
documentation reviewer gpt-6-luna / medium. Inspect only user-facing query/tenant
claims and example options, report affected files and concrete update suggestions;
no edits, builds/tests, prior reviews/memory or children.

Documentation inventory completed under the explicit Luna/medium profile with
no visible mismatch. Affected guidance: server README/REFERENCE, framework
USER_GUIDE, API and architecture overviews. Orders is the smallest suggested
two-context example; broad docs/example edits follow stabilized runtime.

Version-only commit 2ff068cce updates all31 workspace top-level versions to
2.0.0-snapshot.17 and was pushed immediately. JSON comparison proved no other
manifest fields changed in that commit. Pins and lockfile are updated separately;
offline frozen installation and release-policy validation pass. Lockfile-only
resolution reports existing ESLint/glob/node-domexception deprecations; no
dependency upgrade was made. Candidate registry checks covered all19 public
packages. No npm tags or publications changed.

Pins/lockfile commit 4e320831c was pushed immediately. Comparison with the prior
lockfile proves changes are only snapshot.16 -> snapshot.17 substitutions.
Main prepared the five public prose updates identified by the inventory and
checked formatting/audience/whitespace; these claims await runtime completion
and independent review. The implementer remains the only runtime/test writer.

Focused implementation milestones: tenant mismatch before QueryReader and
foreign SUBSCRIBE-only visibility rejection pass after failing assertions;
registered schema is used without reference-identity restrictions. General
SingleTenantIndex.all now reports SINGLE_TENANT and its focused test passes,
while the existing storage partition key stays unchanged. TypeScript build
passes after fixing two newly exposed declaration errors. These are narrow
checks, not release or complete feature acceptance.

## Query and tenant checkpoint

The implementer reports `pnpm exec tsc -b --pretty false` exit 0 and
`pnpm exec vitest run packages/server/test/entity/process-manager-querying.test.ts
packages/server/test/context/tenant-index-direct.test.ts
packages/server/test/services/spine-services.test.ts --maxWorkers=1` exit 0:
3 files, 137 tests passed. Evidence is in the tool transcript; later verification
captures logs under `/tmp/spine-cross-context-queries.ef2mk2`.

Effective tenant handling now reaches repository command/event/storage-context
boundaries, public reads, PM reads and the single-tenant index. The shared lookup
is used for public state routing too. Query reads use registered schema/metadata,
not schema-object-reference rejection. The implementer paused writes while main
formats/lints and captures this intermediate checkpoint. Startup/shutdown tests,
example, remaining TSDoc and full review/verification are still pending.

Read-only test-evidence inventory assignment, before dispatch: orchestrator
function using gpt-6-luna / medium. Compare the approved acceptance cases with
current focused tests; report concrete gaps without edits, test execution,
memory, or child dispatch. This is preparation, not final correctness review.

The shutdown regression separates two paths: environment detachment already
drains Inbox delivery, but an accepted direct CommandBus handler can outlive a
different context's Stand. Target-first registration reproduced `Stand is
closed`; the all-context drain correction passes both registration orders.
The existing server lifecycle suite then passed 150 tests with one worker.

An early deterministic TSDoc check failed on undocumented declarations in
touched files, including existing private methods. Full diagnostics are in
`/tmp/spine-cross-context-queries.ef2mk2/tsdoc-preflight.log`; these and the four
known callable-size findings go to the retained implementer before review.
No full release test run has started.

Read-only test inventory completed under the explicit Luna/medium profile,
without a reported mismatch. It confirmed tenant, visibility, duplicate,
separate-Server and local-query cases, and identified focused evidence still
needed for other Entity families, equivalent descriptors and recovery ordering.

Recovery-order RED/GREEN: moving route installation after delivery attachment
makes the startup probe fail; restoring pre-attachment installation passes.
The lifecycle checkpoint passed TypeScript build and 251 tests across the PM
query, server and bounded-context suites. The shutdown test observes the actual
begin-close operation; no test-only production accessor remains. Main's scoped
ESLint check then found four deterministic corrections, returned immediately to
the retained implementer before pushing. Final TSDoc/size checks, example,
independent review and release verification remain pending.
