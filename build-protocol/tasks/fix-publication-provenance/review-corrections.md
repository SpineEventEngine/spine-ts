# Independent review correction batch

All three fresh reviews are complete. Main accepts the concrete findings below.
The existing implementer handles code and tests; main handles two status-record
corrections. Do not add a new publishing concept or change the approved scope.

## Reliability

1. P1: An uncertain npm result gets only one immediate public read and then throws,
   so executeRelease never reaches the shared confirmation window. Stop later
   uploads, preserve the no-resend rule, and carry uncertainty into bounded
   read-only confirmation. Test an initial 404 followed by delayed visibility.
   Keep one shared window, not one per package or an additional publishing retry.
2. P2: confirmPrepared can update a package status, then return at the deadline
   before saving it. Persist every confirmed change even when time expires
   between packages. Test two packages with expiry between their reads.
3. P2: createReleaseManifest replaces an inspected archive version with the
   expected version without checking equality. Reject a mismatch in prepare,
   before CI uploads the saved release; do not defer detection until publish.
4. P2: Persistent output is created before interruption cleanup is registered.
   Restore the previous ordering with cleanup registered before creation, without
   deleting pre-existing output. Test interruption during creation. Keep this a
   small ordering correction, not a new crash-recovery mechanism.

## Maintainability and correctness

5. P1: An exact-version 404 combined with a tag pointing to that same version is
   contradictory evidence, not permission to upload. Reject it before any npm
   invocation. Include the selected-tag case and consider any returned tag that
   directly claims the version exists; never send an uncertain duplicate.
6. P2: The manifest-tampering loop supplies a wrong checksum and omits sourceSha
   for every case, so an unchanged manifest fails as well. Start with a passing
   control, use the valid checksum and SHA for all unrelated mutations, isolate
   the checksum case, and assert the intended rejection where practical.

## Documentation

7. createReleaseManifest does not sign the JSON manifest. Correct its JSDoc;
   signing is npm/Sigstore provenance for the package archive.
8. Main: label the obsolete investigation in TASK.md as historical and replace
   the misleading current statement that no implementation has changed.
9. Main: label task_plan.md slices as the original approved plan and point to
   the current recorded progress. Do not claim final review/verification complete.

## Main integration check during corrections

The new missing-version/tag guard currently lives in packageState, which is also
used for read-only confirmation. Main reproduced confirmPrepared throwing
immediately when exact-version metadata returns 404 but the selected tag already
points to the just-uploaded version. This must stop permission to upload, but
must not prevent read-only waiting for delayed metadata. Keep the contradiction
guard in publication preflight; confirmation should remain unconfirmed and use
the remaining shared window without another upload. Add a test where tags become
visible before exact-version metadata, followed by successful confirmation.
This preserves findings 1 and 5 together; it is not a new retry policy.

## Verification and handoff

Use focused behavior tests for each correction, then the same cheap preflight
(one worker; formatting, diff, ESLint, tooling typecheck, cleanup and TSDoc).
Do not publish, run full builds, commit/push, or spawn agents. Keep all changed
callables within 35 physical lines and preserve complete, simple JSDoc. Main
will request a fresh focused re-review of substantively affected reliability,
then final security review and one full release verification.
