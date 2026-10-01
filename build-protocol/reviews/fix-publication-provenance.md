# Publishing provenance review record

Requirements: [task ledger](../tasks/fix-publication-provenance/TASK.md).
Baseline: `9e1147298`. Status: the human approved the npm CLI replacement.
Independent plan review is complete; implementation and final reviews continue.

Planned independent concerns:

- Performance/reliability: Sol/medium; actual publishing option propagation,
  request timeout/retry bounds, reproduction validity and failure preservation.
- Documentation: Luna/medium; precise cause versus uncertainty, simple wording,
  current versions and claims about PR checks and live publication.
- Style/maintainability: decide from final code scope after preflight; mechanical
  configuration-only changes do not require an additional style lane. The final
  scope includes new operational scripts, so this concern now requires Sol/medium.
- TypeScript/API docs: N/A if the final changes remain release configuration and
  regression tests, with no framework public type or declaration changes.

Dispatch both model and reasoning explicitly; use fresh contexts without
memory/history. Record results and any corrections before acceptance. Reviewers
must read the whole human-imposed ledger. Historical records are not active
claims unless the current task cites them as such.

No final code-review acceptance or release-readiness claim is made. Correctness and
compatibility review must cover the chosen publishing integration; security
review must cover provenance and authentication if their integration changes.
Those concerns are pending, not waived. Full verification follows the completed
implementation and focused checks; it is not a substitute for recovery evidence.

## npm replacement plan review

The human approved D-0122. Fresh desktop CLI reviewer session
01a0f345-931b-7e10-8257-23a122f1efae used explicit gpt-6-sol/medium and standard
tier, with memories disabled. The native surface had exhausted its thread
capacity. Runtime model metadata is not exposed; explicit dispatch configuration
is the available evidence. The process completed normally without a fallback.

Three findings accepted and incorporated into task_plan.md:

1. Recheck each package's selected tag immediately before publication. The
   serialized workflow prevents internal overlap, not arbitrary external writes;
   document that npm cannot compare and change a tag atomically.
2. Record started attempts before npm invocation and upload the report even on
   failure. A rerun with missing/invalid prior evidence must stop publication.
3. Match npm-hosted attestation subject/digest, repository, commit and workflow.
   Missing records remain unconfirmed; contradicting evidence fails. No custom
   cryptographic verification implementation is introduced.

No production implementation was reviewed in this pass. The actual-stack
reproduction remains the next evidence gate.

## Registry API evidence assignment

Orchestrator-dispatched package/API verification function: explicit
gpt-6-luna/medium, standard tier, no memories and read-only. Independently inspect
public npm metadata and attestations for an existing published package from this
repository, plus pinned npm provenance source. Confirm actual field shapes for
package/digest/source/workflow comparison without designing a custom verifier.
No publication, dependency installation, code writes or children. This supplies
version-specific API evidence, not final code review.

Completed in session `01a0f353-b9ea-7f10-b5d9-27950858d6e6`, explicit
gpt-6-luna/medium, standard tier, memories disabled. Runtime model metadata was
not exposed; no fallback was reported. Its network-restricted sandbox could not
read npm, so main supplied bounded public responses in registry-api-evidence.md.
The initial report incorrectly inferred an unescaped PURL and conflated the
upload attachment with the public attestation endpoint. Returned both findings
to the same context; it executed installed npm-package-arg and corrected both.
The corrected source/API evidence is accepted. No implementation was reviewed.

## Final review assignments, pending preflight

Fresh contexts, no memories, no parent history, no children and no writes.
Use the existing role instructions in the matching `.codex/agents` file.
Compare the branch and working tree to `9e1147298`, including untracked code.
Do not use earlier reviewer conclusions or implementation reports as findings.

- Performance/reliability reviewer: explicit gpt-6-sol/medium, standard tier.
  Publication ordering, limited retries across reruns, uncertain outcomes,
  saved reports, deadline/cancellation, archive validation and preparation cleanup.
  Includes correctness, compatibility and persistence concerns for these scripts.
- Style/maintainability reviewer: explicit gpt-6-sol/medium, standard tier.
  Relevant operational scripts/tests/workflows only; coherent structure, 35-line
  changed callables, documentation, test quality and unnecessary complexity.
- Documentation reviewer: explicit gpt-6-luna/medium, standard tier.
  Release runbook and active task/decision claims, compared to implemented CLI
  and workflow; commands, recovery, version rules, limits and clear wording.
- Final security reviewer: explicit gpt-6-sol/high, standard tier, after the
  preceding findings are resolved. OIDC/config isolation, artifacts and reports,
  provenance identity, input validation, sensitive diagnostics and dependencies.

TypeScript public API/declaration concern is N/A: framework interfaces and
published TypeScript declarations do not change. CLI and saved report contracts
are covered by reliability, documentation and security review. Domain/DDD concerns
are N/A beyond preserving package/release semantics: no application domain,
Entity, Command or Event behavior changes.

Preflight before the review wave: 67 focused tests across seven suites passed;
the real npm/Sigstore reproduction passed. After final formatting, six release
suites passed all 50 tests. Changed-file ESLint, tooling typecheck, cleanup,
TSDoc, formatting and git diff checks passed. Main's documentation audience
check passed. The implementer's report is still being written and will be
formatted separately; reviewers must not use that report as their conclusion.

Review wave dispatched with explicit model/reasoning and disabled memories:

- Reliability: session `01a0f37f-aa91-7821-a6f9-544e8ef13e48`, gpt-6-sol/medium.
- Maintainability: session `01a0f37f-af0c-73d1-8bcc-4f270e01aa72`, gpt-6-sol/medium.
- Documentation: session `01a0f380-4007-7402-9133-f91ab80379ca`, gpt-6-luna/medium.

All use standard tier and fresh contexts. Runtime metadata is not exposed;
explicit configured dispatch is recorded. No fallback was reported at startup.
The implementation is unchanged during this wave. Security review follows the
accepted correction batch.

Documentation review completed normally with its configured Luna/medium profile;
no runtime fallback was reported. Three findings are accepted for the complete
batch: label obsolete investigation text in TASK.md as historical; identify the
plan's original slices versus current progress; remove the incorrect claim that
createReleaseManifest signs its JSON manifest. The runbook otherwise matched
the inspected commands, recovery rules and limitations. Code reviews are pending;
no implementation fixes are applied until the full wave is collected.

The code review wave is now complete, with no fallback reported. Maintainability
found two accepted issues: contradictory 404/tag state could authorize an upload,
and the manifest mutation tests did not isolate their intended failures.
Reliability found four accepted issues: ambiguous upload bypassed the shared
confirmation window; deadline return could lose saved progress; prepare hid
archive version mismatch; and interruption cleanup registration followed output
creation. The full nine-item batch, including documentation, is recorded in
review-corrections.md and returned to the existing implementer context. Main
handles the two status-record edits. Final acceptance remains pending.

The correction batch passed 74 tests across seven focused suites, plus changed
ESLint, tooling typecheck, cleanup, TSDoc, formatting and diff checks. Main's two
status-record corrections also passed formatting and documentation audience
checks. The unsigned-manifest comment is corrected.

Main then reproduced an interaction between the two reliability corrections:
the new pre-upload contradiction guard also aborted read-only confirmation when
tags became visible before exact-version metadata. The guard must still block
uploads, but confirmation must remain allowed within the shared window. This
follow-up is recorded in review-corrections.md and remains to be fixed before
fresh affected-concern review and final security review.

That follow-up is now fixed and covered by a regression: tags can precede exact
metadata/provenance after one npm attempt; preflight still rejects the same
uncertainty before any upload. The two affected suites passed 29 tests; lint,
tooling typecheck, cleanup, TSDoc, formatting, diff and callable-size checks
passed. Documentation corrections are deterministic and complete. A fresh
Sol/medium reliability re-review covers the substantively changed behavior;
fresh Sol/high security review covers the final candidate in parallel. Both
use explicit reasoning, standard tier, disabled memories and read-only access.

Fresh reliability session: `01a0f390-4594-7631-9148-0bde8dbba15b`, explicit
gpt-6-sol/medium. Security session `01a0f390-4a24-7322-963f-bf571fcc0fd9` used
explicit gpt-6-sol/high but failed with "Selected model is at capacity" before
returning findings. No security result is accepted and no fallback is used.
Retry the same required profile; reliability review continues.

The fresh reliability re-review completed with two accepted findings: a fixed
artifact name can leave an older report available after an intervening cancelled
attempt, because validation lacks run-attempt identity; and metadata visible
before its tag still aborts read-only confirmation. Security review was resumed
with the same explicit Sol/high profile and is running normally. Collect its
result before applying the next correction batch. Main also identified the
now-unused pacote override and Lerna-specific metadata test for removal.

Security retry completed normally in the same configured Sol/high session with
no fallback. It confirmed the stale-report issue and flagged a matching payload
without signature/verification material being accepted. The latter is partially
accepted as missing bundle-completeness validation. Independent cryptographic
verification is not adopted: the approved design checks records returned by the
fixed HTTPS npm service, not signatures against a potentially compromised npm
registry. That boundary was explicit in the plan and must remain clear in code
and prose; do not describe structural checks as cryptographic verification.
No other concrete security defect was reported. The combined four-item batch
is in final-review-corrections.md and returns to the same implementation context.

The final correction batch has passed 50 focused tests over publication, CLI
and package metadata; final cheap preflight is pending handoff. Main also checked
the stricter bundle parser against the actual public core snapshot.18 record:
it matches the expected source and complete npm bundle. No registry writes ran.

Next dispatch is a targeted correction recheck, not another whole-change wave:
fresh performance/reliability reviewer, explicit gpt-6-sol/medium, and fresh
security reviewer, explicit gpt-6-sol/high. Both use standard tier, read-only
access, memories disabled and no child agents. Scope is run-attempt evidence,
both metadata/tag visibility orders, bundle completeness and obsolete Lerna
settings. The accepted boundary trusts the fixed HTTPS npm service; it does not
claim independent cryptographic verification. Runtime metadata is unavailable;
the explicitly configured profile is the acceptance evidence unless a fallback
is reported. Dispatch waits for the implementer's final cheap preflight.

Final cheap preflight passed: 52 tests in publication, CLI and package metadata,
changed ESLint, tooling typecheck, cleanup, TSDoc, format, diff and callable-size
checks. No production code changed afterward. The targeted reviewers are now
dispatched under the profiles recorded above; the implementer only finishes its
evidence report. Main's documentation audience check also passed.

Implementer session 01a0f345-089a-7431-b87b-94ee1adb86a6 completed normally
with the configured Sol/medium profile and no fallback. Its report records all
four final corrections and passing checks. Targeted fresh review sessions:
reliability 01a0f39f-1d97-7c60-a55d-afb5e194b506 (Sol/medium), security
01a0f39f-1cbc-7480-b594-5707f253c9dd (Sol/high). Both explicit fields were
present and both started successfully. No production writes during review.

Targeted reliability review completed normally with no P0–P2 findings. Its P3
suggestion for explicit tag-first coverage is already satisfied by
release-cli.test.mjs, "confirms an uncertain npm result after delayed registry
visibility without resending": tags precede metadata in the fixture. No
additional duplicate test is needed. The security recheck remains pending.

Security recheck completed normally with one accepted finding: the v0.3 format
requires an inclusion proof and exactly one DSSE signature, whereas the current
structural check requires a promise and permits multiple signatures. Fix against
the pinned schema, with missing-proof, proof-only and multiple-signature tests.
Stale report protection has no remaining defect. This is a targeted P1 correction,
not a reopened whole-change wave. The same Sol/medium implementer receives it;
estimated additional work 0.1–0.2 hours including focused checks and recheck.

The targeted correction passed 42 tests across publication and CLI plus changed
ESLint, tooling typecheck, cleanup, TSDoc, formatting, diff and callable-size
checks. Main repeated the real public core snapshot.18 record check: matching
provenance is still accepted. The implementer completed normally with the explicit
Sol/medium profile. The same independent security review context now rechecks
only its reported v0.3 defect, explicitly Sol/high, memories disabled, standard
tier, no writes or agents. This is correction verification, not a new full wave.

The v0.3 correction recheck confirms the three requested cases, but accepts one
residual required-field finding: missing kindVersion is accepted by the helper
and rejected by pinned Sigstore's parser. Return this to the same implementer,
with the complete relevant validator comparison and malformed-sibling check,
then prove the deterministic correction against real npm material and the pinned
parser. The broader crypto boundary and documentation are accepted. No model
fallback occurred; configured Sol/high remains the exposed profile evidence.

Main's final deterministic recheck compared the corrected helper with
`bundleFromJSON` from npm 11.16.0's installed @sigstore/bundle, using a freshly
read public core snapshot.18 SLSA record. All six cases agree with the required
outcome in both implementations: real record accepted, missing proof rejected,
proof-only accepted, two signatures rejected, missing kindVersion rejected,
malformed sibling log entry rejected. The comparison made no writes and did not
verify cryptographic signatures. The reported required-field defects are resolved;
final cheap checks remain before the release profile. No additional whole-change
review is needed for this mechanically demonstrated correction.

Final handoff passed 44 affected tests, ESLint, tooling typecheck, cleanup,
TSDoc, format, diff and the 35-line check. Implementer exited normally with the
explicit Sol/medium profile. All accepted findings are resolved; style,
documentation, reliability and security concerns are accepted. Framework
TypeScript/API and DDD concerns retain their recorded N/A reasons. All reviewer
and implementer processes are closed. Final release verification begins now.

Mechanical verification is an orchestrator-dispatched function, not a new role:
explicit gpt-6-luna/low, standard tier, memories and subagents disabled. Scope:
run verify:publish once, then the actual-library Rekor regression and exact
archive consumer proof, capture outcomes, and report without code changes.
Local loopback and network access are allowed for these tests. No npm publication,
workflow rerun, commit or push is permitted to this function. The main agent
retains final integration and remote checks.

Mechanical verification session 01a0f3aa-17f6-7a80-9452-5bb8a178b768 used
explicit Luna/low, standard tier, with no fallback. It ran one verify:publish
invocation: build/checks and 5,133 tests passed, but the dependency audit failed
on two @grpc/grpc-js 1.14.4 advisories. It correctly stopped before subsequent
commands. Its approximate elapsed-time prose is not accepted; process and main
clock observations show the command began around 18:53 UTC, not the duration it
guessed. Test/coverage and audit outcomes are confirmed directly from the log.
The narrow audit-correction.md assignment returns to the existing Sol/medium
implementer. Publishing behavior reviews remain accepted; the dependency update
and fresh verification evidence will receive a separate disposition.

The dependency correction is accepted as a deterministic patch-level update:
main compared parsed lockfiles and confirmed the only added package version is
@grpc/grpc-js 1.14.5 with the official registry integrity; all package/example
manifests are unchanged from HEAD and root still only removes Lerna. pnpm's
unwanted manifest changes, unrelated resolutions and age exception were removed.
Frozen install, both audits (zero known vulnerabilities), 86 focused tests and
cheap static checks passed. The same explicit Sol/medium implementer completed
normally. No publishing code changed and no whole-change review lane reopens.
The Luna/low mechanical function now runs the two previously skipped checks;
the final-commit PR workflow supplies the corrected-tree full release profile.

The explicit Luna/low function completed the two remaining commands: the real
Rekor regression passed, but exact archive preparation failed at its hardcoded
offline consumer installation because pg-protocol 1.16.1 was not cached. No
archive typecheck/runtime success is claimed. Main confirmed the same assumption
can affect CI and returned archive-correction.md to the same explicit Sol/medium
implementer. The method-size rule applies to the now-touched baseline helper.
After cheap checks, only changed preparation reliability/maintainability concerns
need a focused recheck; publication/retry behavior and crypto review do not reopen.

The archive correction's targeted regression and 31 release tests passed; cheap
preflight is finishing. The upcoming targeted review is restricted to
snapshot-artifacts.mjs's exact-all-package consumer refactor and regression.
Dispatch existing performance/reliability and style/maintainability reviewers as
fresh read-only Sol/medium contexts, both fields explicit, standard tier,
memories and child agents disabled. They must preserve the exact archive and
cleanup requirements and avoid reopening unchanged native-only baseline code.
The Luna/low mechanical function will run the real archive proof in parallel
after cheap checks; this is focused verification, not another full profile.

Cheap preflight passed, including a corrected multiline TSDoc opener. Main
removed "unchanged" from a helper's documentation to describe its purpose
directly, with formatting checked. The implementation context has completed
normally. Dispatch the two targeted Sol/medium reviewers and Luna/low archive
proof now; no production changes while they inspect this candidate.

Targeted reliability session 01a0f3c6-c3ea-7030-8661-2c3cab3ae363 and style
session 01a0f3c6-c30a-7831-b872-33df5a379597 both started with explicit
Sol/medium, standard tier, read-only and memories disabled. No fallback reported.
The Luna/low archive command passed, exit 0, from 19:24:54 to 19:25:10 UTC.
Its direct CLI path requires successful installation, source isolation,
TypeScript compilation and the HTTP runtime probe before returning success.
All 19 framework packages came from the exact local archives. No source edits
or publication were performed by the mechanical function; its process closed.

Both focused reviewers completed normally with no P0–P3 findings. Explicit
Sol/medium dispatches were preserved and no fallback was reported. All changed
preparation callables meet the method-size rule; exact archive mappings, source
isolation, compiler/runtime program, ignore-scripts and cleanup are preserved.
All accepted findings are resolved and all participants have exited. Main's
fresh pre-push registry check still finds snapshot.19 absent for all 19 public
packages. Final integration uses the existing branch and human-created PR #14;
GitHub's exact-head checks record corrected-tree full verification. No live
publication is claimed from local checks or PR CI.

# Routing timeout correction review, 2026-10-01

Fresh independent performance/reliability review: explicit `gpt-6-sol` with
`medium` reasoning, standard tier, memories and child agents disabled. Scope:
the uncommitted repository-routing.test.ts correction relative to c92cd98,
the surrounding integration coverage and the measured work in the failed test.
Check whether the delivery-mode change preserves the intended batching and
persistence assertions rather than hiding a local-delivery defect. No source
writes or full builds are allowed. Desktop CLI records explicit configuration;
per-response runtime model metadata is unavailable. Focused tests and static
checks passed before dispatch. Independent session
`01a0f685-263a-77c3-a4a4-d02c683dd8ca` completed with no P0–P2 findings.
It confirmed real persistence of all first-batch IDs, the distinct purpose of
the adjacent remote test and direct-delivery coverage in surrounding tests.
The faster test is not evidence of the original CI timeout's exact cause or a
runtime performance fix. Explicit Sol/medium configuration was verified; no
runtime fallback was reported. The review process exited normally.

This test-only correction changes no public documentation or API. Documentation
and TypeScript/API concerns are N/A beyond checking the evidence and comment.
No production structure or security boundary changed, so prior style/security
reviews are not reopened. Reliability review includes test isolation and
regression coverage. Full release verification will run in final-head CI after
convergence; do not duplicate it locally merely to trigger the same CI gate.
