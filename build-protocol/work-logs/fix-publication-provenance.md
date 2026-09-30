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
