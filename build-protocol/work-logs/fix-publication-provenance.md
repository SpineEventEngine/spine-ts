# Publishing provenance correction

## Start and investigation

2026-09-30: [task and requirements](../tasks/fix-publication-provenance/TASK.md).
Official master is `9e1147298`; the clean managed checkout now uses
`fix-publication-provenance`. Compatibility work remains on its pushed branch.

Native explicit Sol/medium implementer dispatch hit existing thread capacity.
The Desktop bundled CLI starts a fresh implementer context
`01a0f2e4-4f55-7182-92c1-52dc19ec3773`, explicitly `gpt-6-sol`, `medium`, default
service tier, memories disabled. It receives the existing implementer remit,
not a new role. Per-response model metadata is not exposed; dispatch arguments
are the available profile evidence. No fallback reported.

Session skill inventory, expected manifest, readable installed entrypoints
(`rg --files /Users/armiol/.agents/skills -g SKILL.md`), and installed skill lock
were checked. Applicable skills read: systematic-debugging, using-git-worktrees,
test-driven-development, subagent-driven-development, requesting-code-review,
verification-before-completion. The repository's review routing, bounded
verification and existing records take precedence over generic advice to add
more roles, records, worktrees or full baseline builds. Architecture, domain,
browser UI, and API design skills are not relevant to this release correction.

Supplied logs identify 409 conflicts for auth, deployment-gce, and server after
prepare succeeded. Installed path is Lerna10.0.1 → libnpmpublish11.1.2 →
sigstore4.1.1 → @sigstore/sign4.1.1. Provenance creation happens before npm PUT.
The high-level Sigstore client disables `fetchOnConflict`, although the lower
level witness supports it. Its service request timeout defaults to 5seconds.

Read-only production Rekor lookups confirm the referenced entries exist:

| Package        | Record accepted (UTC) | Conflict logged (UTC) |
| -------------- | --------------------- | --------------------- |
| auth           | 15:01:15              | 15:01:22              |
| deployment-gce | 15:01:26              | 15:01:29              |
| server         | 15:01:39              | 15:01:45              |

These are records from the current run, not a prior release. The supplied log
does not reveal the first request's transport error; slow/lost acknowledgement
followed by a retry is the hypothesis being reproduced, not a proven timeout
trace from GitHub.

Official registry/source inspection found latest Lerna10.0.1,
libnpmpublish12.0.1, sigstore5.0.0. The newer Sigstore client still disables
conflict fetching and keeps the five-second default. An upgrade alone is not a
demonstrated correction. Do not patch it, suppress provenance, or implement a
custom publisher. The existing release policy explicitly rules out a
Sigstore-specific timeout workaround. The implementer was interrupted before
making any implementation changes when that constraint was confirmed.

The main context reproduced the failure with the actual installed Sigstore
bundle builder and a local HTTP server. The first POST records the entry and
drops the connection; the second returns 409 with the entry location. Result:
`TLOG_CREATE_ENTRY_ERROR`, two POST requests, zero GET requests. No production
identities or registry writes were used. This checks the configured Rekor
client, not a complete signing or publication run.

The existing lower-level `RekorWitness` supports `fetchOnConflict: true`, but
the high-level client hardcodes false. Lerna also forces automatic provenance
after successful OIDC authentication. A pre-generated bundle therefore needs a
different integration, not just an extra Lerna option. Official npm documents
`--provenance-file`; exact supported version behavior and the complete security
flow must be verified before adopting it. No such integration is implemented.

## Version checkpoint

Registry reads confirmed snapshot.19 absent for all 19 public packages.
`bfd44bae5` changes only the 31 top-level workspace versions to
`2.0.0-snapshot.19` and was immediately pushed. Current dependency pins,
Proto manifest package versions, and relevant version test expectations are
updated separately. Lockfile-only installation passes supply-chain policy.

Frozen installation also passes. Four focused test files pass: release policy,
release CLI, first-package publishing, and Todo startup contracts (59 tests,
14.51 seconds). These establish consistency of the prepared version changes;
they do not establish that publication is fixed. No full build, release gate,
live publication, or independent review has been run for a correction.

## Implementation approval and dispatch

The human approved the npm replacement and one conditional pre-upload Rekor
conflict retry. Snapshot.19 still returns exact-version 404 for all 19 public
packages; freshly fetched origin/master remains 9e1147298. Existing version
checkpoint and dependency edits are preserved.

Standalone codex-cli 0.144.1 rejected gpt-6-sol before work began; its session
01a0f344-13d0-77c3-ba50-5d594f88aada produced no implementation. Switched to the
installed desktop CLI 0.158.0-alpha.2.1 at
/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex. It started
implementer session 01a0f345-089a-7431-b87b-94ee1adb86a6 with explicit
gpt-6-sol/medium, default service tier, memories and child spawning disabled.
Both model fields are explicit; no fallback warning from the capable surface.
The first assignment is reproduction/classification only. Production writes
wait for that result. Profile configuration is recorded because per-response
runtime model metadata is not exposed.

Fresh plan reliability review: existing performance/reliability function,
gpt-6-sol/medium, standard tier, memories disabled, read-only. Reviews the
approved plan and current code while the implementer establishes evidence.
No overlapping writer is introduced. This replaces the failed native dispatch,
not the existing reviewer role.

Earlier planning checkpoint, 2026-09-30: The human chose provenance retention and Lerna removal and
requested careful planning, considering Changesets but allowing other tools.
The [replacement plan](../tasks/fix-publication-provenance/task_plan.md) recommends
the pinned npm CLI with bounded coordination in existing release scripts.
It records the comparison, actual failure-recovery proof required before coding,
all-package confirmation, CI tests, estimate and a proposed single-attempt retry
exception. No implementation has run. Fresh independent review dispatch hit the
surface thread limit; no independent review is claimed.

The paragraph below records the earlier checkpoint. Both the tool-removal
decision and the specific implementation proposal have since been approved.

Request a human decision on changing the publishing approach. Until then,
preserve the evidence and version preparation as a checkpoint, not a completed
fix. After approval and implementation, run cheap preflight, independent
relevant reviews, then one `verify:publish` and archive proof. Do not create a
PR or run a real publication. PR-only CI requires a human-created PR; no branch
CI success is claimed.

## Implementation checkpoint

Independent plan review completed in desktop CLI session
01a0f345-931b-7e10-8257-23a122f1efae (explicit Sol/medium, standard tier, no
memories). Its three findings are incorporated into the plan. The existing
implementer continues production work after the local npm/Sigstore evidence.
Main caught that the first fixture shortened the actual GitHub error; the
implementation was interrupted to require the full recorded message and record
ID. See recovery-evidence.md for the evidence and correction, not a live-release
claim.

The version-pin checkpoint `35f1075c9` passed 42 focused tests and was pushed
immediately. Broad release instructions are updated in parallel. A separate
Luna/medium read-only assignment checks actual public npm attestation fields.
Full verification and final independent code reviews remain pending.

## Final implementation and integration

The npm replacement and all accepted review corrections are implemented. Fresh
review profiles and outcomes are recorded in the dedicated review log. No
runtime model fallback was accepted; per-response runtime metadata was not
available from the selected surface. All participating processes have exited.

The first local full release run passed build/checks and 5,133 tests with all
coverage dimensions above 90%, then failed the dependency audit on grpc-js
1.14.4. Its compatible 1.14.5 patch was applied without unrelated resolutions,
manifest changes, new overrides, age exceptions or audit suppressions. Frozen
install, both audits, 86 affected tests and static checks passed afterward.

The actual npm/Sigstore regression passed. The exact archive proof first exposed
hardcoded offline installation; the bounded verifier correction passed focused
tests, static checks and fresh reliability/maintainability review. The real
prepare --check passed on 2026-09-30 at 19:25:10 UTC for all 19 local archives,
including the external consumer compile and runtime check.

The existing feature branch is pushed to official origin after committing the
implementation. PR #14 is human-created and remains the source of truth for the
exact final SHA and its full verification checks, including both dependency
audits, release profile, actual-library regression and archive proof. An earlier
green SHA must not be reported as final. No workflow rerun, real publication,
merge, tag mutation or third-party patch was performed. Live OIDC publication
can only be established by a later authorized protected publishing run.

## CI routing-test investigation

Build run 36765936378 for c92cd98bcc8dbf07ae601c4e26985843fbb39474
passed installation and both dependency audits, then failed the release profile.
The public check annotation identifies one 15-second timeout: the existing test
that retains the first Process Manager recipient batch when a later handoff
fails (repository-routing.test.ts:8160). The archive and npm-regression steps
were skipped. This run is not accepted as a green result.

The existing implementer (01a0f345-089a-7431-b87b-94ee1adb86a6) resumes with
explicit gpt-6-sol/medium, standard tier, no memories or child agents, first to
reproduce and trace the timeout. Do not increase timeouts or retry CI without
evidence. Expected correction and focused verification/review: 0.5–1 hour,
including the subsequent GitHub verification wait. Per-response runtime model
metadata remains unavailable; explicit dispatch configuration is recorded.

The implementer completed the investigation with no lasting code change. The
named test passed twice without coverage (3.97 and 3.95 seconds), and with
coverage (6.18 seconds). All 324 routing tests passed in the file-level run;
the partial coverage commands exited 1 because the repository-wide coverage
thresholds are not achievable with only that file. These commands are not a
replacement for the full release gate. Temporary phase instrumentation was
removed; it measured about 26 ms to the first handoff, 3.9 seconds through
dispatch and the intended second-batch failure, and 35 ms for reading rows and
closing the context. No timeout increase or speculative correction was made.

Full GitHub logs could not be downloaded through the public API (403); the
in-app browser also requires sign-in, and no other browser is connected. The
current blocker is the missing full failed-job log. Request the downloaded log
or an authenticated browser before continuing the investigation. CI remains
red at c92cd98; no publication, rerun, new commit or push was performed during
this investigation.

## Routing timeout follow-up, 2026-10-01

The human supplied the failed-job summary: one timed-out routing test, 5,133
passing tests, and 842.20 seconds of test execution. It still does not locate
the slow await, but confirms the isolated failure. Resume the existing
implementer with explicit Sol/medium, standard tier, memories/children disabled.
Investigate scaling and unnecessary work in the 1,000-recipient path before
choosing a correction; neither a timeout increase nor a speculative runtime
change is an acceptance criterion. Preserve batching, first-batch persistence,
ordering and failure assertions. Estimate: 0.5–1 hour including focused
verification, independent relevant review and CI. Desktop CLI supports the
explicit model/reasoning fields; per-response runtime metadata is unavailable.

### Implementer correction and focused evidence

The first-batch test combined two behaviors: durable handoff across the 1,000
recipient boundary and immediate local replay of every recipient. The latter
made the test expensive. Direct `LocalEntityInbox.receiveAll` writes 1,000 rows
and then drains them one at a time; each direct drain enters the shard delivery
path and reads its inbox page. Temporary diagnostic runs under V8 coverage
measured about 0.33 seconds for 100 distinct reactions, 2.03 seconds for 500,
and 6.12 seconds for 1,000. A one-recipient diagnostic did not exercise this
batch path. These measurements show growing repeated delivery work but do not
establish a production correctness defect or the exact await that timed out in
CI. Temporary diagnostic edits were removed.

The bounded test correction transfers delivery to environment ports backed by
the **same in-memory storage** before dispatch. The actual `receiveAll` still
persists all 1,000 distinct first-batch recipients, now as pending rows without
1,000 unrelated handler replays. The test checks every stored recipient ID,
first-batch persistence, ordered handoff, lazy second-batch construction, the
single warning, and the intentional second-batch rejection. Production runtime
code and the 15-second limit are unchanged. The retained test took 132 ms
without coverage, compared with about 3.9 seconds before the correction.

Focused verification passed:

- `pnpm exec vitest run --maxWorkers=1 --testTimeout=15000 packages/server/test/repository/repository-routing.test.ts -t 'records the first Process Manager recipient batch before a later handoff fails'`: 1 test passed.
- `pnpm exec vitest run --coverage --coverage.reporter=none --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=0 --maxWorkers=1 --testTimeout=15000 packages/server/test/repository/repository-routing.test.ts -t 'records the first Process Manager recipient batch before a later handoff fails|sends every remote Process Manager batch and preserves earlier rows on failure'`: 2 tests passed; focused thresholds were zeroed because this is not the full coverage gate.
- `pnpm exec vitest run --maxWorkers=1 --testTimeout=15000 packages/server/test/repository/repository-routing.test.ts`: all 324 tests passed.
- `pnpm exec eslint packages/server/test/repository/repository-routing.test.ts`, `pnpm exec prettier --check packages/server/test/repository/repository-routing.test.ts`, `pnpm typecheck:tooling`, `pnpm lint:cleanup`, and `git diff --check`: passed.

The full release profile and GitHub workflow were not rerun. CI remains red at
`c92cd98` until a later final-head run verifies this correction. No publication,
commit, or push was performed in this implementation pass.

The human challenged the causal explanation before any correction was pushed.
The earlier downloaded successful prepare log at baseline 9e114729 records the
same test at 8,839 ms, all 324 routing tests at 21,040 ms, and overall test time
541.25 seconds (1_prepare.txt in logs_99479141341.zip). The failed run reports
842.20 seconds overall. Runtime source, this test, Vitest configuration, Node
version and the release test command are unchanged in c92cd98. Parsed lockfile
comparison shows one added package version, grpc-js 1.14.5, no changed metadata
for retained package versions, and 334 removed versions after Lerna removal.
This is evidence of a previously expensive test and a slower run, not proof
of the exact cause. The existing Sol/medium implementer will inspect the
dependency and release-test differences for plausible cross-test effects
before accepting the test-only correction. No additional code change or full
verification run is authorized in this diagnostic assignment.

The human additionally requested a separate performance analysis with a
sub-second target for 1,000 signals. The reproduced scenario is one event
routed to 1,000 Process Manager instances. Measure application execution
without coverage and separate instrumentation overhead; identify storage,
handler/state commit and acknowledgement costs. A faster test is not a
runtime fix. Keep this work read-only apart from a concise analysis record
and disposable diagnostics; propose any runtime optimization before expanding
the implementation. Additional estimate: 0.3–0.6 hours for profiling, source
analysis and a plain-language report, partly overlapping the current reviews.

The read-only causal comparison found no concrete regression: Vitest's fresh
run ordering puts this largest test file before release-script tests, the
new npm reproduction step runs after the failing gate, and a focused import
trace loaded neither grpc-js nor Datastore. Retained test-runner, coverage,
protobuf and Linux native binding snapshots are unchanged. Failed-run
per-file timings are still unavailable, so the broader slowdown is not
attributed to a proven cause. Independent review session
01a0f685-263a-77c3-a4a4-d02c683dd8ca accepted the focused test correction
with no P0–P2 findings. The correction is ready to commit and push after final
format checks; GitHub must verify the resulting exact head.

The same Sol/medium implementer will next profile the original direct delivery
scenario separately, using disposable diagnostics and an external analysis
report. It may not change runtime code or the reviewed test correction.
Report operation counts and stage timings at 100/500/1,000 recipients, including
the repeated inbox scans and full-map copies in the memory commit path.
No performance claim is accepted until the measurements support it.

## 1 October: approved Entity storage and delivery correction

The earlier routing-test correction was pushed as `74c6b5615` and its exact-head
CI passed. The separate runtime investigation then identified whole-collection
memory copies and repeated Inbox prefix scans. After reviewing current official
JVM source, the human requested a plan, approved its independent review, and
authorized implementation. The prior analysis-only restriction above is now
superseded for this approved extension, not for unrelated runtime changes.

The approved plan and ledger are in
`tasks/fix-publication-provenance/entity-save-delivery-plan.md`; its architecture
and no-memory independent review are recorded beside it. Planning/rules checkpoint
`2a4a64610` passed cheap document checks and was immediately pushed to origin.
D-0123 records the accepted correction. Version-only snapshot.19 preparation
already exists on this branch and must remain separate from runtime changes.

Implementation uses one explicitly dispatched Sol/medium context,
`01a0f732-e0c9-7970-a2d5-67afc04e3d69`, standard tier, memories/children disabled.
Native capacity was exhausted, so the capable Desktop CLI is used. Actual runtime
metadata is not exposed; explicit profile fields are recorded and no fallback
was reported. Main retains Markdown documentation and Git integration. A parallel
fresh Luna/medium source inventory completed without edits and identified the
affected active documentation and established live-provider test commands.

The repeatable baseline uses real Event delivery and verifies all final states:
five fresh 1,000-recipient runs measured 4,041–4,289 ms without coverage on
Node 24.18.0 / Apple M3 Max. Detailed settings and raw measurements are in the
implementation report. The under-one-second requirement is not yet met.
The storage and delivery slices are implemented. Entity commits no longer
compare expected old state, memory prepares only affected records, Inbox scans
finish before restarting, and early cleanup and retained-row checks share the
applicable clock. Follow-up work reduces repeated ID and query preparation.
Focused verification passed 590 storage tests, 68 selected server tests,
affected typechecks, lint, TSDoc, formatting and cleanup rules. The selected
memory commit file exceeds all four coverage thresholds.

Real PostgreSQL 16/18, MySQL 8.4 and MariaDB 11.4 checks passed, including
MyISAM/Aria partial-write behavior. Datastore Inbox cleanup passed; tracing of
its combined Entity/history test confirms commits and appends completed before
history trimming stalled. The complete test still fails and is not reported
as green. All disposable containers were removed. Full details are in the
task progress and implementation reports.

The uncontended five-run result is 1,163–1,182 ms, still above the one-second
goal. Further optimization is paused for an independent Astra/high assessment
of the demonstrated blocker and narrower profiling of the timed operation.
This checkpoint is not merge-ready: performance acceptance, independent code
review, final release verification and final-head CI remain. No merge or package
publication is authorized. Snapshot.19 remains the existing common version;
the latest registry check found no such version for the 19 public packages.

Checkpoint `f5f6cce81` was pushed immediately. A fresh no-memory requirements
splitter assessment used explicit Astra/high, Standard tier, with child agents
disabled. The surface exposes configured dispatch, not actual runtime metadata;
no fallback was reported. It found a bounded next step rather than a demonstrated
need to change the validation dependency. Restore the public `SpecScanner.scan`
signature and keep prepared metadata internal. Measure passing existing validated
ID metadata through Stand's repository-only deferred update path, retaining it
only with correctness checks and measured benefit.

The assessment also corrected the profiling evidence: coordinator-only profiles
do not describe delivery work, and transformed source locations in the original
profile had mislabeled `tagged` and `normalize` frames. The implementer has now
captured CPU samples in the worker around the timed Event post itself. These
show substantial validation/registry and Inbox conditional-update work, but do
not prove an unavoidable one-second floor or justify bypassing validation.
The same Sol/medium implementation context will receive the accepted correction
batch after its diagnostic-only assignment finishes. Its explicit model and
reasoning remain required; no new production writer is assigned.

The bounded follow-up restored the public scanner signature and passed 66
Stand/scanner, 10 selected repository and 62 Inbox/storage tests. Stand metadata
reuse gave a small repeated measured improvement, but five final runs remain
1,077–1,159 ms. The benchmark now checks exactly one handler call for each ID.
The same explicit Sol/medium context receives the next source-backed batch:
the checkpoint CI lint findings and preparation of the same Entity record twice
in Stand and the repository. Existing conditional record equality may avoid
JSON encoding only if equivalence, including sparse-array behavior, is proven.
No check or validation may be removed for performance. These bounded candidates
and their constraints are recorded in implementation-preflight-corrections.md.
Remaining estimate is 0.8–1.5 hours including review and release/CI waiting;
the measured performance gap remains the uncertainty.

The prepared-record slice passed 411 focused tests, 90.74% selected branch
coverage, targeted typechecking, all-changed-file ESLint/formatting, cleanup and
TSDoc. It corrected ten CI findings and seven additional test lint findings.
Final five timings remain 1,072–1,122 ms; overlapping baseline results do not
establish a reliable large benefit for record reuse in isolation. Validation is
preserved, and mutation tests cover state, Version and lifecycle during awaits.
The comparison replacement was rejected because it changes sparse-array
equality. The next bounded measurement uses the same explicit Sol/medium
implementer to test direct canonical-key encoding with identical output,
including numeric object keys and array holes. Only the memory key encoder,
its tests, benchmark measurements and performance report are assigned. No new
cache, public API, altered comparison or dependency change is authorized.

Independent documentation and stable storage/Inbox review are complete, with
one wording correction and one remote removed-cursor regression queued for the
combined finding batch. The API review is running independently; style and the
final changed-path reliability review remain. The branch is not merge-ready.
