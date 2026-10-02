# Recover from temporary registry read failures

## Request and baseline

2026-10-02. User supplied `logs_100186386735.zip` and requested an explanation
of incorrect assumptions, fresh local master, a new branch and a fix.
Official master updated to `881931d0f`; clean attached checkout reused for
`fix-release-registry-reads`. No new chat or worktree was created.

## Human-Imposed Requirements Ledger

- Fix the demonstrated failure, explain previous assumptions in simple words.
- PR CI must exercise publishing procedures except real publication-service
  I/O. Include the demonstrated failure in those checks, not only happy paths.
- Keep trusted publishing, provenance, source/hash/tag checks and snapshot-only
  advancement. No third-party patches, tokens or actual publication.
- No blind re-upload after an uncertain outcome. Temporary read failure must
  never mean package absence, success, or authorization to upload again.
- No huge per-package waits, broad new framework, speculative work or bypasses.
- Bump every workspace version to the next unused snapshot in a version-only
  commit with exact message `Bump version -> <version>`; separate pins/lockfile.
- Push each feature commit immediately. Do not create/merge a PR, rerun remote
  workflows, change npm tags or publish packages.
- Independent reviews use no conversation history or memory. Preserve unrelated
  changes; one production writer; simple documented functions and focused tests.

## Initial evidence and uncertainties

Run `36987801599`: preparation and preflight succeeded. Publishing started at
09:30:04 UTC and failed at 09:32:51 on a 10-second exact-version registry read
for delivery-client snapshot.20. Error originates in readRegistry() timer.
The log does not reveal which publication phase called that read or why the
remote response did not arrive. Its saved publication-report artifact is
11219477112; attempt to read it before making upload-outcome claims.

Code inspection: registry timeouts reject as generic Errors, callers do not
classify temporary read failures, and confirmPrepared() exits on any thrown
read instead of continuing within its existing shared window. The trial's
HTTP fixture replies immediately; its interruption deliberately expects a
failed run, so it never proves recovery from a transient read outage.

## Plan and acceptance

**Current scope correction:** the 2026-10-02 human clarification below replaces
the earlier retry-only solution. npm accepting an upload and the public
registry exposing it are separate outcomes. Read retries remain useful for
preflight and explicit verification, but cannot establish a visibility deadline.

High-risk narrow release reliability correction because upload safety must
remain intact. Main Astra/high performs one scoped design pass after evidence;
no new subsystem or dependency is needed. Confirm root cause, reproduce with
actual asynchronous request/body behavior, then implement the smallest bounded
safe GET recovery. Preserve terminal metadata/security errors and cancellation.
Temporary failure exhausting its budget remains an explicit non-success report.
Tests must demonstrate eventual read recovery, persistent outage stopping
within the bound, no duplicate upload, and unchanged contradiction rejection.
Update the regular CI trial and release guide to match actual behavior.

Estimate 0.5–0.9 hours: investigation and regression (0.15–0.25), implementation
and versions (0.15–0.25), focused checks/review (0.1–0.2), full verification
and integration/reporting (0.1–0.2 plus CI waiting if a PR exists).
Use cheap preflight before one verify:release after convergence. No baseline
full suite; existing merged-tree CI passed. CI requires a human-created PR.

## Skills and assignments

Session skill catalog and repository EXPECTED_SKILLS.md inspected. Selected:
systematic-debugging, test-driven-development (including testing anti-patterns),
subagent-driven-development, requesting-code-review, verification-before-
completion, using-git-worktrees (reuse only). Repository task records replace
the skills' separate ledgers; repository role/model rules take precedence.
No new API/framework/DDD/ADR feature; corresponding design skills are N/A.
Installed source/lock inventory is checked before implementation dispatch.

Desktop supports explicit profiles. Native slots may be occupied by previous
tasks; bundled CLI with explicit profiles and memories/delegation disabled is
an available execution surface. No child may spawn children.

- Read-only evidence/version verification: orchestrator-dispatched Luna/medium.
- Bounded implementation: existing implementer, explicit Sol/medium.
- Technical review: existing reliability and style reviewers, explicit
  Sol/medium; documentation reviewer Luna/medium. Collect findings before fixes.
- Mechanical verification: orchestrator-dispatched Luna/low.
- Main handles task records, version-only commit and integration. Runtime
  profiles must be explicit; record session IDs and any metadata limitation.

## Scoped design after initial evidence

Main Astra/high pass: preserve current publication architecture and upload
policy. Correct the custom GET reader, not npm or Sigstore. Official npm config
documents safe read retries for network/5xx failures (two retries by default):
https://docs.npmjs.com/cli/v11/using-npm/config/#fetch-retries . Existing
Node-only release jobs deliberately do not install workspace dependencies;
use built-in fetch and small shared release-specific request code, no new
dependency or generic retry framework. No third-party source modification.

- Share bounded read handling between the existing preflight and publication
  readers. At most three GET attempts, keep the current 10-second per-attempt
  limit, short bounded delays, and honor any shorter caller deadline. Do not
  increase the shared 60-second confirmation window or add per-package windows.
- Retry only temporary transport/timeouts and appropriate HTTP429/5xx errors.
  Real404 remains absence; permission errors, bad JSON/schema, contradictory
  hashes/tags/provenance remain fatal. Never turn a transport failure into404.
- During confirmation, temporary read failures remain unconfirmed and may be
  revisited within the shared window. Preserve completed evidence and never
  trigger another npm upload merely because confirmation failed.
- Add regression tests before production edits: actual asynchronous fetch
  rejection, headers/body stalls, transient response then recovery, permanent
  outage within deadline, malformed/denied metadata, and no duplicate upload.
  Include real loopback HTTP behavior or real Response streams where useful;
  test bodies that do not settle, not only immediate JSON promises.
- Extend the existing regular-CI trial with a transient timeout/recovery case
  through real entrypoints and guarded fake publication I/O. Do not replace
  validators, fabricate success on an exhausted budget, or contact publishing
  services. Add concise phase/package diagnostics if necessary so later logs
  distinguish upload from confirmation without secrets or raw npm output.

Evidence session `01a0fc14-3321-7f10-931f-2dc50b6f2cf1` used explicit
Luna/medium and exited; actual profile self-introspection is unavailable. All
19 snapshot.20 exact reads currently return 200 with integrity and attestation
URL; all 19 snapshot.21 reads return 404. The delivery-client encoded path works
now. This does not establish the original call phase. Its publication time
reported by npm is later than the supplied job failure; do not invent why.
GitHub reports attempt 1 failed, not a successful rerun. The artifact download
is unavailable: anonymous API 401 and configured gh credentials 401. Logs do
prove the uncaught timeout. Continue with safe reproduction; request the saved
report only if original phase is required for a claim.

Installed entrypoints and skill-lock.json verified for selected skills. Reuse
isolation checked clean/merged before branch creation; no baseline full suite
or dependency installation was repeated (project protocol supersedes that
skill default). Fresh independent implementation is assigned only release
scripts/tests/docs; main alone handles workspace version alignment and records.

## Implementation progress

Version-only commit `53effe619` updates all 31 workspace manifests to unused
`2.0.0-snapshot.21` and was immediately pushed to origin. Dependency pins,
lockfile and current generated-manifest version declarations are aligned
separately. Frozen offline installation passes.

Implementer session `01a0fc16-f61d-78e1-b320-e2232ac86d96` was dispatched
explicitly as Sol/medium, Standard, memories and child delegation disabled.
Only release scripts, corresponding tests, release guide and implementation
record are assigned to it. Configured profile is recorded; runtime
self-introspection is unavailable.

The public delivery-client snapshot.20 provenance names commit `881931d0f`
and workflow run `36987801599/attempts/1`. Thus that package was published by
the failed workflow. This still does not identify the original read phase or
explain npm's publication timestamp. No remote mutation was performed.

## Human clarification: publication is not immediate public visibility

The user points out that newly published versions can take an unknown time to
become publicly readable. Main checked executeRelease() and publishAttempt():
the current code saves npm exit 0 as an accepted attempt but marks the package
unconfirmed, then requires public confirmation before the publishing command
can succeed. That coupling is the wrong assumption. Fixed read retries alone
do not correct it. Mechanical checks on the initial retry work now pass, but
that work is not accepted as the complete fix.

Revised narrow design (main Astra/high pass for the changed success condition):

1. Save npm exit 0 as successful publication. A normal successful publishing
   command does not call public confirmation after uploads. Keep provenance
   enabled on every real npm invocation, plus archive/source/version validation.
2. Keep verify-registry as an explicit read-only check. Its report must say
   what is publicly visible, independently of the accepted upload result.
   Delayed visibility must not turn a successful upload into a failed one.
3. An uncertain npm result remains uncertain. No absent, unavailable or delayed
   registry response permits re-upload. Preserve the existing narrowly proven
   pre-upload Rekor-conflict exception; do not add any upload retry policy.
4. On a writing rerun, validate the previous report against the same run,
   immediately previous attempt, source and archive hashes. A saved accepted
   upload is sufficient to skip that package even while it is invisible.
   Require consistent attempt order/status and a recorded zero npm exit code
   before trusting an accepted result. Reject contradictory evidence before
   any write; do not trust a status label by itself.
   Check remaining packages with existing rules. Contradictory evidence must
   never authorize a write. Do not weaken checks for unfamiliar existing versions.
5. Add regressions and a complete guarded CI trial where all uploads succeed
   but the new versions remain invisible indefinitely (404 and old tags).
   Existing pre-upload tag reads for remaining packages still operate normally.
   Assert success and exactly one upload per package. Cover partial-run recovery while accepted packages
   remain invisible, and uncertain results still blocking duplicate uploads.
6. Revise the release guide, report wording and tests to distinguish successful
   publication from optional public visibility checks. No new scheduling,
   monitoring service, credentials, third-party patch or report subsystem.

Before implementation, obtain one fresh independent reliability review of this
changed success/recovery plan using Sol/medium, no history or memory. Then
return accepted findings and the revised assignment to the existing implementer.
The final code reviews and full release verification are still required. The
additional contract correction adds approximately 20–35 minutes to the initial
estimate, including focused checks and review; the full gate remains single-pass.
