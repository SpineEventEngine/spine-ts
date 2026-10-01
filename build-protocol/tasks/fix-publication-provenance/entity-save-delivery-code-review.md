# Entity storage and delivery implementation review

Scope: the approved extension after `74c6b5615f1195861ffb7570652be7bff1759a95`,
including its immediate affected paths. Earlier publishing changes retain their
separate review evidence. No publication or merge is authorized.

All assignments use fresh contexts without chat history or memory, Standard
speed, explicit model and reasoning, and no child agents. The Desktop CLI
supports the required explicit profiles; actual runtime metadata is not exposed.
Acceptance requires checking the dispatched fields and any reported fallback.

## Documentation review

Assigned existing documentation reviewer: Luna/medium. Read-only review of the
changed human-facing storage/server/delivery reference pages, API and architecture
guides, changed technical specification and decision text. Check correctness,
simple wording, compatibility consequences and misleading atomicity or performance
claims against current source. Runtime follow-up and its TSDoc remain with the
implementer and later API review; do not review moving performance reports as
completed evidence. Return concrete findings with source references, not edits.

Completed with explicit Luna/medium dispatch, memories/children disabled; no
fallback reported. One accepted low-severity finding at storage/REFERENCE.md:18:
replace the generic phrase “atomic commit contracts” with “Entity commit
contracts”, because MyISAM/Aria can leave ordered partial writes. The reviewer
confirmed the conflict/version distinction, provider compatibility notice,
Datastore transaction statement, scan behavior, and clock/dedup limits.
Correction is queued until the complete review wave is collected. Full report:
`/tmp/entity-delivery-doc-review.md`.

After collection, main replaced that phrase with “Entity commit contracts”.
The correction changes no technical guarantee; final document checks remain
part of the shared preflight.

## Remaining concerns

- Performance/reliability: explicit Sol/medium read-only assignment starts on
  the stable provider commits and Inbox scan/retention paths. Their focused
  checks passed; current CI corrections in these paths are lint-only. Exclude
  active repository/Stand preparation and any later memory equality change;
  those require the concluding reliability review before acceptance. Inspect
  the known Datastore trim timeout as a verification limitation, not a passed
  test. No full suite, edits or child agents.
- TypeScript/public API: required; includes preserving `SpecScanner.scan` and the
  changed provider-only Entity commit port. Check the exported `DeliveryInbox`
  interface and its optional retention-clock method against the compatibility
  wording; do not assume a port is private merely from its filename.
  Assigned fresh read-only existing API reviewer, explicit Sol/medium, after
  all-changed-file lint/format and the 411-test focused coverage gate passed.
  Review runtime/type agreement and prepared-record reuse as it now stands;
  later canonical-key encoding is internal and outside this active assignment.
- Style/maintainability: required for the changed production paths.
  Assigned fresh existing style reviewer with explicit Sol/medium after all
  changed-file gates passed. The encoder experiment has been reverted; runtime
  files are stable at checkpoint `9ad2492ae` while review runs.
- Concluding reliability assignment: fresh existing performance/reliability
  reviewer, explicit Sol/medium, reads the repository/Stand prepared-record and
  descriptor paths plus the real benchmark omitted from the earlier review.
  No production writer runs during these two concluding assignments. Both are
  read-only, Standard tier, without memory, inherited chat history or children.
- Dedicated security: not reopened by this storage-performance extension, which
  adds no authentication, external input surface, credentials or publication
  authority. Existing final publishing security evidence remains applicable;
  tenant boundaries and mutation checks receive reliability review.

Collect the complete applicable review wave before returning one accepted fix
batch to the existing implementation context. Review results and dispositions
will be added below; none is yet accepted as clean.

## Storage and Inbox reliability result

Completed with explicit Sol/medium, fresh ephemeral context, Standard tier,
memories/children disabled, with no fallback reported. Accepted medium-severity
finding: forward scanning can delete a full page's last expired delivered row,
then `RemoteValues.exactAfter` rejects the now-absent cursor. The old productive
page restart avoided this combination. Add a remote drain regression with a
productive full page ending in an expired row, and correct continuation without
skipping messages at equal timestamps or weakening existing paging checks.
The report is `/tmp/entity-storage-reliability-review.md`.

The reviewer found the other assigned memory/provider and Inbox invariants
intact. It explicitly retained the Datastore trim timeout and unmet one-second
target as limitations, not successful verification. Repository/Stand prepared
record reuse and any later equality changes remain outside this completed
portion and require review. The accepted correction is queued for the combined
review-fix batch.

## TypeScript and API result

Completed in a fresh explicit Sol/medium context with memories/children disabled
and no fallback reported. The reviewer inspected the latest deferred input
snapshots as well as committed changes. Two accepted P2 findings:

1. `DeliveryInbox.retentionTime` and `RemoteInbox.retentionTime` expand exported
   application-facing declarations despite `@internal`. Move clock access behind
   an internal adapter connection; preserve injected-clock behavior and avoid a
   public clock service.
2. `RepositoryStand.preparedRecord` repacks original mutable inputs when IDs
   differ, while Stand notifications use the pre-await snapshot. Build that
   fallback from the prepared record, replacing only its authoritative packed
   ID, and test mutation during a delayed read on this branch too.

   Prefer simplifying this to one record-copy-and-ID-replacement path if that
   preserves all existing checks: clone the prepared EntityRecord and set its
   packed authoritative ID. That needs no equality branch, no repacking of
   mutable state, and no original state/version/lifecycle arguments carried
   through commit helpers solely for a fallback. ID validation, cancellation,
   history data and subscriber snapshots must remain covered.

The scanner signature, provider commit entrypoint, bundled implementations and
inspected descriptor/version/history contracts were otherwise clean. Full
report: `/tmp/entity-delivery-api-review.md`. No tests/builds were run by the
reviewer. These findings join the complete-wave correction batch; style and
the final narrowed reliability check remain.

Implementation boundary for clock correction: remove all new public clock
methods, including those on `Inbox` and `InboxStorage`, not merely the two
examples in the finding. Local delivery already has the concrete `Inbox` and
its `storage`; a module-internal storage accessor can read its configured clock.
Remote delivery can retain the existing local-wall-time fallback. Prefer that
existing construction path over adding another published cross-package clock
registration API. Preserve tests with a storage clock ahead of and behind wall
time, and the exact expiry boundary.

## Main's deterministic test-oracle check

Pending correction in `packages/storage/test/memory/canonical-key.test.ts`:
the draft old-key reference uses ordinary `kind` and `payload` properties as
type markers. The actual old implementation uses private Symbols, so an ordinary
object with those two fields is not a tagged bigint/bytes value. Preserve the
real marker distinction in the reference and add collision-shaped ordinary
objects to the equivalence cases. This is a test-oracle correction, not a
finding against the new production encoder. Include nested combinations and
read-order evidence before accepting exact-equivalence claims.

The encoder experiment and its experiment-only test were subsequently reverted
because no repeatable speed benefit was measured. The test-oracle finding is
therefore absent from current code, not accepted as a valid oracle. Any future
encoder experiment must use the real marker distinction from the outset.

## Concluding review results and accepted batch

Style review completed with explicit Sol/medium in a fresh no-memory context.
Accepted P2: the opt-in benchmark must assert every measured run is below
1,000 ms, not merely print timings and pass state assertions. Keep it opt-in
and print all raw timings before assertion; ordinary CI remains free from a
wall-clock threshold. No other confirmed style/test-quality finding was reported.
Report: `/tmp/entity-delivery-style-review.md`.

The concluding reliability reviewer (also fresh explicit Sol/medium) traced an
additional provider input-isolation defect while following the commit path:
staging captures history keys, then awaits and reads caller records again.
Changing a history version in that interval can write a different staged key
and silently omit the history record from publication. Accepted P1 correction:
snapshot affected input records and ID before queuing/asynchronous work, then
use the same snapshots for keys and writes. Cover both a queued caller change
and a change while staging is in progress with deterministic tests. Copy only
the affected input, never saved collections. Report:
`/tmp/entity-prepared-reliability-review.md`. This additional finding is accepted
despite extending its requested scope; final narrowed review must still cover
repository/Stand behavior after the fixes.

The complete wave is now collected. Return one batch to the same explicitly
configured Sol/medium implementer: wording, private clock access, remote cursor
continuation, prepared-record ID replacement, in-flight input snapshots, and
benchmark acceptance assertion. No issue is waived. After focused mechanical
checks, re-review only substantively changed contracts and execution paths.

Main interrupted the correction context after it proposed restarting from the
beginning whenever cleanup removes a full page's last row. That would restore
the repeated-prefix problem for retained rows followed by expired rows. Preserve
the forward-scan requirement: track successful removals within the current page
only and choose its last surviving row as the continuation. If every row was
removed, keep the preceding surviving continuation (or the initial start when
there was none). Nothing retained before that position needs replaying. Cover
both duplicate and expired-row removals, fully removed pages, equal-time
boundaries and the existing error for an unrelated missing remote cursor.
Do not keep a growing scan-wide set or relax ambiguous remote ordering checks.
The interrupted context keeps its edits and resumes with this clarification;
it is not replaced by another writer.

One final measured performance candidate may accompany that batch: a read-only
diagnostic compared 1,485 keys against the actual built `TenantRecords.capture`
and found identical keys using direct tagged encoding with native
`Object.fromEntries`/`Object.entries` enumeration. This avoids the unsuccessful
experiment's second custom sort and numeric-name parser. Three 10,000-key loops
measured 108.60/104.44/105.20 ms for current encoding versus 68.75/67.56/68.16 ms
for that alternative. This is component evidence only, not delivery acceptance.
If tried, retain only exact-key behavior and measured benefit; no new cache,
public API, validation bypass or dependency change. Use proper Symbol markers
in any retained old-key reference. Full delivery still must pass its new assertion.

## Built-output verification correction

The benchmark imports storage through the package entrypoint, which resolves to
`dist`; Vitest has no source alias for that import. The earlier encoder experiment
ran `tsc --noEmit`, not an emitting build. Its before/after timings therefore do
not establish the candidate's performance. The same implementer was interrupted
and resumed with an explicit requirement to emit the affected packages before
the retained-source baseline and after each candidate change. Correct unsupported
claims in the performance report rather than treating that experiment as evidence.

Checkpoint `9ad2492ae` CI also failed the declaration build: the exported
`repositorySpecScanner` variable at `spec-scanner.ts:58` lacks an explicit type
required by `isolatedDeclarations`; dependent declaration errors follow from that
missing output. The affected emitting build must pass before final verification.
Run: https://github.com/SpineEventEngine/spine-ts/actions/runs/36865616152

## Planned focused correction review

After the complete correction batch passes its focused mechanical checks, use
two fresh, read-only contexts with explicit Sol/medium, Standard speed, no memory,
no inherited discussion and no child agents:

- Existing performance/reliability reviewer: affected-input snapshots and
  publication in memory; repository/Stand snapshot and authoritative-ID behavior;
  forward continuation after deletions; local retention clock; any retained key
  encoder's exact equivalence and real rebuilt performance evidence. Check tenant
  selection as well as record values around queue waits. Do not invent mutation
  requirements for immutable schema configuration.
- Existing TypeScript/API reviewer: no new public clock methods; scanner's
  original public signature and emitted declarations; repository prepared-record
  simplification, input validation, cancellation and notification behavior; TSDoc
  accuracy for these corrected paths.

The wording correction and explicit benchmark threshold are deterministic fixes
and do not alone reopen documentation/style review. New substantive findings are
returned together to the same implementation context. Earlier unrelated publishing
review evidence remains applicable.

Dispatch starts after corrected-source emitting builds, changed-file lint,
formatting, cleanup and TSDoc checks passed. The combined selection passed 541
tests; its partial-file coverage selection did not meet the global threshold and
is not accepted as final coverage. The added remote first-page regression also
passes. Runtime edits have stopped while the implementer finishes its report.
Both reviewer assignments below are explicitly Sol/medium, Standard, ephemeral,
with memories and child agents disabled. No runtime metadata is exposed by this
surface. Performance acceptance remains unmet and is an explicit review input.

Both focused reviews completed without a reported profile fallback. Reliability
confirmed one remaining tenant-isolation defect: commit input records are copied,
but their context/tenant value is still shared across the queue wait. Snapshot
the actual selected tenant for current, history and delivery records and cover a
queued caller mutation. The other assigned correctness paths, direct encoder and
test oracle had no further confirmed findings. Its optional suggestion to remove
one duplicate delivery-Event clone is not a finding and does not address the
benchmark path without delivery Events; defer it rather than adding speculative
work. Report: /tmp/entity-corrections-reliability-rereview.md.

API review found only stale local delivery-client declarations that still expose
the removed clock method. Regenerate that affected package and inspect its output;
this is a missing local build step, not a surviving source method or a published
artifact. Report: /tmp/entity-corrections-api-rereview.md. Both fields were explicit
in both dispatches; actual runtime metadata remains unavailable.

The human now explicitly prioritizes green CI. The latest checkpoint c6b8397d2
is running verification after passing audits. Return this complete correction
batch to the same Sol/medium implementer: tenant snapshot regression/fix, emitting
all affected package outputs, and mandatory cheap preflight. Do not add further
performance experiments before completing that verification. Full release and
exact-head CI must pass; review completion does not substitute for either.

CI c6b8397d2 failed before tests because `scripts/check-api-docs.mjs` still
requires the intentionally removed EntityCommitResult export. Full authenticated
logs confirm the same local failure. The configured environment GITHUB_TOKEN is
expired; invoking gh with GITHUB_TOKEN and GH_TOKEN unset uses the existing valid
saved login without changing credentials. No logs from the human are now needed.
Main takes the deterministic two-list correction in the documentation checker
and its fixture; these files are outside the implementer's current assignment.
Run the existing checker tests and actual generated-document check. All other
expected exports and documentation validation remain required.

The two-list correction passes all five existing checker tests and the actual
TypeDoc generation/export check. The implementer also completed every other
non-test gate after the isolated formatting correction. Regenerated delivery-client
declarations no longer expose the removed clock method. The tenant regression
failed before the fix and all 25 memory commit tests now pass.

Dispatch final narrowed tenant review: existing performance/reliability concern,
fresh explicit Sol/medium, Standard, no memory/history/children, read-only. Inspect
only the memory commit/test diff since c6b8397d2 and adjacent tenant/lock selection.
Confirm call-time tenant capture, fixed handle scope, associated records in the
same tenant, and rejection of a genuinely different tenant. No full branch review
or performance certification is requested. Runtime is stable while this runs.

Final tenant review completed with explicit Sol/medium and no reported fallback;
actual runtime metadata is unavailable. No further findings in the assigned
tenant/backend/history/Event lock paths. Report: /tmp/entity-tenant-final-review.md.
The 25 focused memory commit tests pass; changed commit coverage is 95.79%
statements and 93.02% branches. The queued test demonstrated the defect before
the fix. All accepted correctness/API/documentation/style findings are resolved.
Full release coverage, archive consumer proof and final-head CI are still required;
the under-one-second benchmark remains a separate unmet acceptance requirement.

Final mechanical verification assignment: orchestrator-dispatched function,
explicit Luna/low, Standard, no memories or child agents. Run verify:publish once
on the corrected checkout, then the actual-library Rekor reproduction and exact
archive consumer proof used by CI. Capture complete logs and command exits under
/tmp. Do not edit files, Git state, thresholds, timeouts or dependencies, and do
not run another test worker or benchmark concurrently. Stop on a failing command
and return its exact evidence. Main follows the exact pushed PR head on GitHub.
