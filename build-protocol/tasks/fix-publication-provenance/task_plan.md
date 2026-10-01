# Replace Lerna: planning

## Current branch extension: Entity saves and Inbox delivery

On 1 October the human requested a written plan and independent review for
the storage and delivery corrections identified during the routing performance
investigation. See [the correction plan](entity-save-delivery-plan.md).
This extends `fix-publication-provenance`; it does not create another branch.
The human approved implementation on 1 October after plan review. Runtime
implementation is in progress. Earlier publishing completion evidence does not
verify these corrections.
The architecture pass and fresh independent plan review are complete. Accepted
findings are incorporated, with no unresolved product questions.

## Scope and requirements

The human approved the npm CLI replacement and its narrowly bounded retry on
2026-09-30. Implementation, focused tests, relevant review and final verification
are now authorized. Real publication, workflow reruns and merging are not.
Preserve the existing version checkpoint and all unrelated changes.

Keep the current common snapshot versions, snapshot-only tag advancement,
19-package public inventory, prepare/publish separation, and strict handling of
uncertain registry responses unless an explicit proposed change is accepted.
Do not patch dependencies, disable provenance, or add long batch retries.

## Planning phases

1. Inspect current release preparation, selection, workflow, policy, and tests.
   Status: complete.
2. Inspect the current stable Changesets source and supported options, including
   authentication, package discovery, partial failures, and reruns.
   Status: complete.
3. Compare approaches, define implementation slices and acceptance checks,
   review uncertainties, and report the proposed plan in simple words.
   Status: complete; independent plan review completed through the desktop CLI.

## Approved approach

Use the pinned npm CLI for each already-tested tarball. Keep pnpm for dependency
installation, building and packing. Do not add Changesets: our versions are
already decided before merge, and its publishing layer still needs our registry
checks, error recovery, exact inventory and reporting. Removing Lerna alone does
not fix the upstream Sigstore error. A fresh npm invocation regenerates signing
material; whether that reliably recovers this exact reproduced conflict must be
established before the procedure can be called corrected.

This is a bounded replacement in existing release scripts, not a reusable
publishing library, custom signing implementation, scheduler, database, or
handwritten registry mutation client. Only npm publishes and creates provenance.

## Original approved implementation slices

These are the accepted requirements, not a current to-do checklist. The local
recovery evidence and implementation are complete. Independent reviews,
including security, have returned findings and the accepted corrections passed
focused verification and targeted correction rechecks. The local full build and
tests passed; the audit found a transitive dependency needing a patch update.
That correction passed fresh audits and focused checks. Final-head PR CI is the
full verification gate for the corrected tree.
See [current progress](progress.md), [task status](TASK.md) and the
[review correction batch](review-corrections.md) for the current outcome.

### 1. Establish recovery evidence before wiring CI

- Use the pinned npm/libnpmpublish/Sigstore versions. Confirm the exact observable
  npm failure for TLOG_CREATE_ENTRY_ERROR with HTTP 409 from Rekor, and prove it
  occurs before npm receives a package-upload request.
- Reproduce conflict followed by one fresh npm attempt against local test
  services or controlled process/network fixtures. Do not request real identities,
  publish real packages, patch vendor source or weaken signature validation.
- A fake CLI response proves orchestration only, not real OIDC or Sigstore
  recovery. Keep the actual-library failure reproduction separately identified.
- If the CLI does not expose enough evidence to distinguish this from a registry
  upload conflict or unknown failure, do not infer retry safety from message
  fragments. Report the limitation and revise the proposed recovery before coding.

### 2. Preserve prepared packages and release policy

- Persist the existing packer's result as a small release manifest: source SHA,
  common version, tag, package names, relative tarball paths and SHA-512 hashes.
- Validate the exact public inventory, actual archive names/versions/content,
  hashes and source SHA before any publication. Reject extra/missing packages,
  private fixtures, path escapes, stale artifacts and unsupported version forms.
- Keep external-consumer proof in prepare and PR checks. Publish those tarballs
  directly; remove .publish extraction and the disposable Lerna workspace where
  no other consumer needs them. Do not rebuild in the credential-bearing job.
- Keep snapshot.N versions and snapshot-only tagging. No Changesets version,
  changeset files, changelog generation, release PR automation, Git tag creation,
  npm tag repair or latest-tag movement is introduced.

### 3. Serial npm publication and bounded recovery

- Reuse the existing public inventory and runtime-dependency order. Complete
  strict registry preflight before starting; distinguish confirmed absence from
  authentication errors, malformed metadata, timeouts and service failures.
- Reject a selected tag already pointing to a newer version before the first
  write. Preserve the serialized workflow queue; do not rerun an older release
  to move that tag backwards.
- Recheck that package's selected tag immediately before each npm invocation,
  including its permitted second attempt. This reduces the stale-check window;
  npm has no atomic compare-and-publish tag operation. Do not claim protection
  from a simultaneous external publisher changing a tag between check and write.
- Run npm publish <archive> --provenance --ignore-scripts --access public
  --tag <validated-tag> --registry https://registry.npmjs.org/ once per missing
  package, in order. No stored token, local login or npm API reimplementation.
- Approved policy change: only the proven pre-upload
  Rekor conflict permits one additional fresh npm invocation for that package.
  Never retry the entire release or increase Sigstore timeouts. Retain both
  attempts' redacted diagnostics. Stop if the second attempt fails.
- For any ambiguous upload outcome, do not resend merely because a registry read
  returns 404. Mark the outcome unconfirmed, inspect exact-version metadata, and
  leave the run unsuccessful unless publication can be established safely.
- An unrecovered failure stops later package writes. The report distinguishes
  confirmed published, already present, failed, unconfirmed, and not attempted.
  Reading all 19 package states remains automatic; no manual package checklist.

### 4. Confirmation and reruns

- Always produce a package-by-package report, including on publisher failure.
- After successful publication, check exact name/version, selected tag, tarball
  integrity and provenance record against prepared artifacts. Preserve the
  pre-run latest tag for snapshots. Use public read endpoints, not bare-name
  npm view queries that silently select latest and mishandle snapshot-only data.
- Check the npm-hosted attestation's subject package/digest, source repository,
  source commit and publishing workflow. Missing evidence is unconfirmed;
  contradictory evidence is a failure. npm/Sigstore remain responsible for
  cryptographic signing/validation; do not build a custom verifier.
- Use one shared 60-second confirmation window after the publication phase,
  with bounded requests and cancellation; do not multiply that wait by 19.
  A delayed registry/provenance record becomes unconfirmed, never unpublished
  or permission denied solely because it is not yet visible. No writes during
  this confirmation loop. This window is a proposed operational bound, not an
  assertion about npm's propagation guarantee.
- Rerun the failed publication job at the same commit with the same saved
  archives. Revalidate everything, skip versions whose expected state is
  confirmed and publish only missing versions. Different bytes, wrong tags,
  stale source or newer selected tags stop the rerun rather than being repaired.
- Save the per-package attempt report with the run artifacts. A previously
  accepted or ambiguous upload is not reclassified as safe to resend because
  the next run sees 404. Resolve its exact-version state positively or stop;
  only never-attempted packages and proven pre-upload failures are eligible
  for publication while that distinction matters.
- Record an attempt as started before invoking npm, then its outcome. Upload the
  report in an always-run workflow step. A rerun must load the previous attempt
  report and validate its run/source/archive identity; missing or invalid prior
  evidence stops writes. A cancelled runner may fail to upload, so the workflow
  must not equate a missing report with no earlier publication attempt.
- Keep the existing all-already-published preflight policy unless explicitly
  changed. Add a read-only verification command for the case where publication
  succeeded but confirmation failed; it never sends a package-upload request.
- Preserve first-publication bootstrap as a separate manual procedure. Existing
  manually published versions without provenance must not be silently adopted
  into a provenance-required run. The current human rule is to advance every
  package to a new common snapshot after manual bootstrap.
- Artifact retention and recovery instructions must state what happens if the
  original artifact expires: do not silently rebuild and claim byte-identical
  recovery. Use a new release unless deterministic equality is established.

### 5. Remove Lerna and align records

- Remove lerna.json, the direct dependency, Lerna-specific workspace builders and
  tests. Regenerate the lockfile; check obsolete transitive packages disappear.
- Update release CLI/workflow tests to test behavior rather than whole-script
  string equality. Do not preserve a parallel unused publishing implementation.
- Update docs/release-publishing.md, scripts documentation, governing decision
  and active completion claims. Preserve explicitly historical records.
- Record this as replacing the former no-custom-publisher decision with a small
  npm CLI coordinator; specifically approve the narrowly bounded conflict retry.
- Recheck that snapshot.19 is still unused for every public package. Preserve
  the existing version-only commit if valid; otherwise choose the next unused
  common version without rewriting pushed history. Finish pins and lockfile
  separately, as required by the protocol. No additional bump just for planning.

## Acceptance tests and review

Focused deterministic PR tests must cover successful publication of all packages;
exact tarball/flags/tag/order; no private or development-only packages; lifecycle
scripts disabled; explicit provenance; no token fallback; partial recovery;
the proven conflict then success; repeated conflict; upload conflict distinct
from Rekor conflict; authentication failure with no retry; ambiguous upload with
no retry; 404 followed by delayed visibility; persistent unknown status; malformed
or failed registry reads; wrong integrity/tag/source; absent provenance;
opposite-tag preservation; summary on failure; and all-published read-only checks.
No test may publish to production or contact real OIDC endpoints.

Run cheap formatting/diff/typecheck/focused checks first. Then relevant independent
Sol/medium reliability and maintainability review plus Luna/medium documentation
review; TypeScript public API concern is N/A because no framework API changes.
Assess security at release readiness with Sol/high for the OIDC/artifact/retry
boundary. Fix confirmed findings in one batch. Run verify:publish and archive
consumer proof once after convergence, reusing generated outputs as supported.
Push each implementation commit immediately and require final-SHA PR CI.
Do not call live trusted publication proven by dry-run, fixture tests or green
PR checks. It is proven only by an authorized real publishing run after merge.

## Planned review dispatch

Existing performance/reliability reviewer: gpt-6-sol, medium, explicit fresh
context with no history or memory. Read-only review of this proposal, candidate
tool evidence, recovery safety and missing decisions; no code, tests or children.
Desktop supports these explicit fields. Runtime metadata will be recorded if
exposed; otherwise dispatch configuration is the available evidence.

Initial dispatch result: a fresh performance/reliability reviewer with explicit
gpt-6-sol/medium and fork_turns:none was rejected by the execution surface:
agent thread limit reached. No review ran. Main source-based plan checks are
complete, but are not an independent review. Do not reuse a historical reviewer
with earlier task memory and call it fresh. Independent review remains required
before implementing the irreversible publication behavior.

Completed alternative dispatch: desktop CLI session
01a0f345-931b-7e10-8257-23a122f1efae, explicit gpt-6-sol/medium, standard tier,
memories disabled and read-only. Three findings accepted: per-package tag
rechecks, required prior-attempt reports and explicit attestation identity.
All are incorporated above. This is plan review, not final implementation review.

## Implementation estimate and decision

Estimated active agent work after approval: 1.5–2.5 hours:

- Actual-stack recovery/classification evidence: 0.2–0.4 hours.
- Artifact handoff and npm command coordination: 0.35–0.55 hours.
- Registry confirmation, summaries and rerun behavior: 0.25–0.4 hours.
- Focused regression checks and CI integration: 0.25–0.4 hours.
- Lerna removal, version consistency and documentation: 0.15–0.25 hours.
- Independent relevant review, fixes and handoff: 0.3–0.5 hours.

Some source verification/documentation review can run alongside implementation;
there is one writer for release scripts. Full verification and remote CI waiting
add roughly 0.25–0.5 hours if infrastructure is healthy; no live publication is
included. Revise promptly if the first reproduction cannot establish safe recovery.

Human decision: approved the npm CLI approach, including the single conditional
fresh attempt for the proven pre-upload Rekor conflict. This is a narrow exception
to the earlier prohibition on publishing retry workarounds. Recovery must still
be established by the first implementation slice before enabling that behavior.

## Classification and estimate

Planning for a high-risk release-tooling change: authentication must remain
token-free and reruns must not overwrite or misreport published packages.
Planning is complete. Implementation estimate and boundaries are recorded above.

## Skills and execution

Read monorepo-management and planning-with-files completely from the exposed
installed skill inventory. Inspected the project expected-skill manifest.
Use existing task records instead of scattering root-level planning files;
repository record locations take precedence over the generic skill template.
No new worktree or chat is needed. Desktop supports explicit child model and
reasoning selection. Main architecture work uses Astra/high. Any dispatched
source verification uses Luna/medium; reliability review uses Sol/medium.
Implementation/testing skills were read when the human approved implementation:
subagent-driven-development, test-driven-development (including testing
anti-patterns), using-git-worktrees and requesting-code-review. Reuse current
records and the existing isolated checkout. Repository-specific reviewer routing
and focused verification override generic skill advice to add roles or repeatedly
run complete builds. There are no completed implementation slices to redispatch.

## Implementation assignment

Existing implementer function, explicit gpt-6-sol/medium, standard service tier,
memories disabled. Responsible for scripts/release*, relevant focused fixtures,
workflow and package metadata changes after the reproduction gate. Main retains
task/decision records, documentation and integration. Do not spawn children or
revert existing version preparation. Native child dispatch capacity is exhausted;
use the installed capable CLI with explicit model/reasoning, preserving the same
existing role. First assignment is bounded to reproduction and classification;
continue in that context for implementation if evidence passes.

## Errors and limitations

Large combined reads were truncated; subsequent inspection is bounded by file
and subject. Some old records still describe a pending publishing-tool decision;
the new human decision supersedes that part, not the unproven failure fix.
