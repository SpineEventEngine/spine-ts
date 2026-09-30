# Planning progress

2026-09-30: Planning begun after the human selected provenance retention and
Lerna removal. Read the protocol, current task records, workflow, package
manifest, and relevant skill instructions. No build, test suite, dependency
installation, or registry write has run in this turn. Next: source-based
Changesets compatibility and failure analysis.

Source comparison completed for Changesets 3.0.3, pnpm 11.9.0 and npm 11.16.0.
Recommendation: npm CLI per prepared tarball, retaining pnpm for the existing
build/pack workflow. Proposed one conditional fresh attempt requires acceptance
and pinned-stack evidence. Current workflow lacks the final verification its
runbook claims; the plan explicitly includes it.

Fresh Sol/medium reliability review dispatch failed at the surface thread
limit. No reviewer result is claimed. The main agent checked the plan against
the sources and existing policy, recorded recovery and visibility uncertainty,
and prepared the human-facing comparison and implementation breakdown.
Only planning records changed in this turn; no commit or push was made.

Planning-record formatting and git diff --check passed. Clarified that a rerun
must preserve an earlier ambiguous upload outcome; a later 404 cannot authorize
blind resubmission. No tests or full builds ran.

## Approved implementation

The human approved the npm replacement. Independent Sol/medium plan review
completed through the capable desktop CLI and three findings were incorporated.
The local pinned npm/Sigstore reproduction and formatter test passed. Production
implementation continues in the same Sol/medium context; no publication is run.
Main updates the release instructions and task records in parallel.

All 34 pre-existing tracked version-pin, generated-manifest and test changes
were compared against HEAD and contain only snapshot.18 to snapshot.19 changes.
The version-only checkpoint remains separate. Read-only exact-version queries
returned 404 for snapshot.19 across all 19 public packages at this turn's check.

Focused verification passed: 42 tests in release-policy, publish-new-package and
Todo startup-contract suites, one worker, 2.23 seconds. The 34 version-related
files were committed as `35f1075c9` and immediately pushed to official origin.
This is a version consistency checkpoint, not a claim that publishing is fixed.
GitHub CLI inspection returned HTTP 401 for its saved credentials; SSH push
succeeded. Remote check inspection needs a working read-only access path.

Broad release documentation now describes direct archive publication, bounded
Rekor recovery and the read-only confirmation command. Its final correspondence
to implementation remains subject to documentation review. Formatting passed.

The corrected actual-library fixture uses the complete recorded Rekor UUID
message. It and the classifier tests passed. Independent Luna/medium API evidence
completed after correcting its PURL and public-attestation endpoint claims in
the same context. Main supplied actual public responses because the reader's
sandbox lacked network access. Production implementation continues.

Unauthenticated public GitHub API access succeeded and found human-created PR
#14 at the pushed checkpoint. It is attached to this chat. Final-head CI can be
inspected through that read-only route; the CLI credential issue is not a blocker.

The initial replacement passed six focused suites (39 tests) after a frozen
ignore-scripts install removed 324 now-unused installed dependency packages.
Lerna and its configuration/discovery tests, plus the unused old publisher, are
removed in the working tree. Formatting and cleanup checks passed at that point.

Main's real npm configuration smoke check failed: using `/dev/null` for both
user and global config makes pinned npm exit before any publish. Main returned
this plus retry-count, archive-version, interruption-cleanup and callable-size
checks to the existing implementer as one preflight correction batch. The same
explicit Sol/medium CLI context continues. No final review or full release gate
has run, and no publishing-fix completion is claimed.

The implementer completed its assignment. Its final checks passed: 67 focused
tests across seven suites; the actual-library Rekor reproduction; changed-file
lint, tooling typecheck, cleanup, TSDoc, formatting and diff checks. A final
six-suite run after formatting passed 50 tests. Main's documentation audience
check passed. All five main preflight findings have recorded corrections.

Three fresh independent reviewers are now reading the unchanged implementation:
reliability and maintainability use Sol/medium; documentation uses Luna/medium.
Main also ran the new confirmation function read-only against actual public
core@2.0.0-snapshot.18 metadata and SLSA provenance at source 9e1147298. It
returned `already present` with no attempts. This checks real public response
compatibility, not trusted publication of this branch.

The first review wave and subsequent focused reliability/security checks found
bounded corrections recorded in the review log. The existing implementer is
applying the final batch: immediately preceding run-attempt evidence, either
order of registry/tag visibility during confirmation, complete npm provenance
bundles, and removal of obsolete Lerna dependency settings. The release guide
now explains that public record confirmation is not independent cryptographic
signature verification. Main's read-only check of real core snapshot.18 metadata
and attestations also passes with the stricter bundle-completeness check.

Remaining estimate: 0.5–0.8 hours of agent work for focused checks, targeted
re-review, one full release verification and archive proof, records and push;
GitHub CI waiting is additional. No real publication is authorized or performed.

## Final implementation and local verification

All publishing and preparation review findings are resolved. The local full
build/checks and 5,133 tests passed (306 files; statements 93.26%, branches
90.03%, functions 93.04%, lines 94.45%), but its subsequent audit exposed two
transitive grpc advisories. The only additional dependency update is grpc-js
1.14.4 to 1.14.5. Both audits then passed, as did 86 affected tests and static
checks. Unrelated changes made by pnpm's update command were removed; exact
snapshot.19 pins and the release-age policy remain unchanged.

The real-library Rekor regression passed. The first exact-archive check exposed
the verifier's assumption that every transitive tarball was cached. Its install
now permits third-party downloads, still disables installation scripts and
still pins every framework package to the prepared local archives. Targeted
tests and static checks passed. Two fresh independent Sol/medium reviewers found
no issues in that correction. The real prepare --check then passed for all 19
archives, including consumer isolation, typechecking and the HTTP runtime probe.

The standalone version-only commit bfd44bae5 and dependency-pin checkpoint
35f1075c9 were already pushed. Main integrates the reviewed implementation on
the same branch and immediately pushes it. The exact final commit and full PR
verification outcome are recorded by Git history and
[PR #14](https://github.com/SpineEventEngine/spine-ts/pull/14). The corrected tree
must pass that full CI profile; earlier local tests do not replace it. A final
pre-push registry read still found snapshot.19 unused for all 19 packages.
No package publication or merge has been performed.
