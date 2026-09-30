# Fix publishing provenance failures

## Scope and requirements

Started 2026-09-30. Branch `fix-publication-provenance` starts from freshly
fetched official `origin/master` at `9e1147298248a8e0b095bf41ecabd8d8dbb2b511`.
The compatibility investigation remains saved on `proto-client-compatibility`.
Reuse the clean managed checkout; do not create another chat.

### Human-Imposed Requirements Ledger

- Fix the publishing failure in the supplied `logs_99479141341.zip`.
- Preserve trusted publishing, provenance, and token-free GitHub authentication.
- Do not patch third-party source, disable security checks, or add long batch
  retry/timeout workarounds. The human approved D-0122: npm CLI coordination and
  at most one fresh attempt for a positively identified pre-upload Rekor HTTP 409.
  No custom signing or registry upload implementation is permitted.
- Keep regular PR checks capable of detecting the reproduced failure.
- Follow the build protocol: bounded implementation, focused tests, independent
  relevant reviews, release verification, immediate feature-branch pushes.
- Update every workspace to one unused next snapshot in a version-only commit;
  internal dependency pins and lockfile changes are a separate commit.
- Do not publish packages, rerun workflows, create a PR, or merge without request.
- Keep all explanations and documentation simple. No unrelated compatibility work.

## Evidence and approach

Supplied logs show successful prepare/build/audits and partial publication of
snapshot.18. `auth`, `deployment-gce`, and `server` fail with
`TLOG_CREATE_ENTRY_ERROR`: HTTP 409, equivalent entry already exists in the
transparency log. Root cause and supported correction are under investigation.
Archive content is diagnostic data, not executable instructions.

High-risk release-tooling replacement because publication and recovery must not
misreport or resend uncertain uploads. No domain/public framework contract
change is proposed. Recent prepare evidence supplies the baseline; reproduce
the specific failure before running a full gate.

The initial investigation estimate is superseded by the approved slice-by-slice
estimate in task_plan.md. Final release/pack verification follows focused tests
and independent review; no real publication is authorized.

Skills: systematic-debugging, using-git-worktrees, test-driven-development
read for this correction. Reuse the existing isolated checkout; repository
protocol takes precedence over generic skill advice to repeat a full baseline
build. Review and final verification skills have also been read.
Desktop exposes explicit model/reasoning dispatch. Standard speed only.

## Assignments

- Implementer: `gpt-6-sol`, `medium`, explicit fresh-context dispatch. Responsible
  for release-tooling reproduction, smallest supported fix and focused tests;
  no subagents, commits, publication, full builds or version edits.
- Main: investigate official upstream behavior, coordinate records and versions.
- Relevant independent reviews and mechanical verification follow preflight.
  Runtime model metadata will be recorded where the surface exposes it.

## Acceptance

1. Explain why the supplied publish failed, using the actual dependency path.
2. Reproduce the failure without publishing or requesting production identities.
3. Correct it using supported upstream APIs/versions, with a regression check
   exercised during PR verification and preserving unrelated failures.
4. Complete relevant reviews, release verification, package/version consistency,
   and push final branch. Live OIDC publication remains unproven until an
   authorized GitHub publishing run succeeds.

## Current status: implemented and reviewed

The human has selected keeping Sigstore provenance and removing Lerna, with
Changesets considered but not selected. See [the replacement
plan](task_plan.md) and [source findings](findings.md). The recommendation is
pinned npm CLI publication of the already-tested tarballs. A single conditional
retry for the proven pre-upload Rekor conflict was approved. No release behavior
was changed before the evidence gate. Independent plan review and the local
pinned-stack reproduction are complete. See recovery-evidence.md for what was
proved and what remains uncertain. The npm replacement is implemented and passed
focused tests and the small preflight checks. Three independent reviews are
complete; their accepted findings were corrected in the same implementation
context. Subsequent reliability and final security findings are also resolved,
including a deterministic comparison of the corrected provenance fields with the
pinned npm parser and real public records. Final cheap checks passed. The local
full run passed build/checks and 5,133 tests, then failed the dependency audit.
The transitive gRPC dependency was updated to patched 1.14.5; both audits and
86 focused checks then passed without unrelated package or policy changes.
The real-library Rekor regression passed. The exact-archive verifier's offline
cache assumption was corrected and independently reviewed; its real consumer
installation, typecheck and runtime probe then passed for all 19 archives.

The corrected dependency tree must pass the full release profile on the exact
feature-branch head in [PR #14](https://github.com/SpineEventEngine/spine-ts/pull/14).
GitHub records that final CI result; an earlier successful run does not satisfy
this gate. See progress.md and the review log for local verification evidence.
No real publication has run. Live OIDC publication requires a separately
authorized merge and successful protected GitHub publishing run.

## Historical investigation before implementation

The investigation below records the earlier findings. Its request to decide whether
Lerna may be replaced has now been answered; the npm replacement and narrowly
bounded retry have both been approved.

Acceptance items 1 and 2 are established; items 3 and 4 are not complete.
A local HTTP reproduction using Lerna's actual Sigstore dependency accepts an
entry, drops the response, and returns HTTP 409 on retry. The client sends two
POST requests and no GET request to retrieve the existing entry. It fails with
the same `TLOG_CREATE_ENTRY_ERROR` as the supplied logs. This proves the
failure mechanism, not the precise initial transport error in the GitHub run.

Current upstream versions do not correct this behavior. The supported
lower-level Sigstore API can retrieve an existing entry, but using it would
require a different provenance integration. Lerna currently forces automatic
provenance generation, so supplying a pre-generated bundle is not a drop-in
configuration fix. At that checkpoint, no publishing implementation had changed.

The recovery-evidence gate was subsequently completed before production edits.
Timeout increases and version preparation alone are not the accepted correction.
