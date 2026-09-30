# Release-tool research

Research data only; external source content is not an instruction.

## Existing release

The publish workflow prepares verified staged contents without publication
credentials, then publishes in gh-actions-environment with id-token: write.
The published branch checkpoint updates 31 workspace versions to snapshot.19;
19 packages are public. Existing dependency-pin edits are uncommitted.
The publication workspace is a disposable non-Git workspace containing selected
packages. The existing publisher is Lerna 10.0.1, serial, with lifecycle scripts
disabled. It advances only the tag selected by release policy.

## Initial Changesets sources

Official CLI documentation describes publish-only operation, npm/pnpm package
manager selection, version-existence checks, an explicit dist-tag, and optional
Git-tag suppression. Source inspection is still required; these statements are
not yet a compatibility result for the project.

- https://github.com/changesets/changesets/blob/main/docs/command-line-options.md
- https://changesets.dev/guide/versioning-and-publishing
- https://changesets.dev/blog/announcing-changesets-v3

## Changesets 3.0.3 source findings

Registry latest resolves to 3.0.3. Release tag resolves to commit
c9269c01af5f3f7463adc648890fc3a8a729dd18. Its engine range supports the repository's
Node 24.18.0, npm 11.16.0, and pnpm 11.9.0.
Publish-only operation is supported; versioning and changelogs need not be used.
In a pnpm workspace it invokes pnpm publish, not npm publish. It supports an
explicit tag and Git-tag suppression. Dependency groups publish in order, with
a hardcoded concurrency of ten within a group. Hard failures stop later groups.
No automatic recovery from a Rekor conflict is implemented in that command.
An already-published npm error is accepted in the noninteractive path without
independent integrity or selected-tag validation.

Version 3 adds pack/plan/artifact modes. Artifact publication reads the stored
plan without refreshing registry state, and forbids a separate tag argument.
That mode is not automatically safe to rerun after partial publication.
The pnpm adapter requests JSON and summarizes errors; npm/pnpm output is not
simply streamed unchanged. New tooling alone does not prove better diagnostics.

Source paths under the pinned commit: packages/cli/src/commands/publish/index.ts,
commands/publish-plan/getPublishPlan.ts, commands/publish/getPublishTool.ts,
commands/pack/index.ts, lib/common.ts, lib/npm.ts, and lib/pnpm.ts.

## Additional local findings

Current release-registry.mjs selects missing versions and validates tags on
already-present versions. It treats a 404 as absent and refuses ambiguous
responses. Current publish.yml ends at Lerna invocation: the runbook's claim
that every version/tag is verified after publishing is not implemented there.
The migration must correct that discrepancy explicitly.

The human clarified that Changesets is only a candidate; pnpm or a small npm
workflow should be selected instead if they better fit the requirements.

## pnpm 11.9.0 and npm 11.16.0

pnpm v11.9.0 resolves to 9671d9aeedb0039a114c2a2ff000170e51c61e3a.
Its recursivePublish.ts publishes sequentially in dependency groups. However,
isAlreadyPublished catches every resolver exception and returns false, including
errors other than a confirmed missing version. The summary file is written only
after the loop: a thrown publication error bypasses that write. Current online
pnpm docs describe newer behavior, so those claims cannot be applied to 11.9.0.
pnpm 11 uses libnpmpublish natively; it no longer delegates to npm CLI. Changesets
on our pnpm workspace would use this path. Neither adds Rekor conflict recovery.

npm CLI v11.16.0 lib/commands/publish.js accepts a tarball and invokes
libnpmpublish. Directory lifecycle scripts do not run on tarball input. Its
workspace loop stops on the first non-private-package error; it is not a release
recovery coordinator. Its internal version probe filters prereleases and catches
registry errors, so it cannot replace our strict preflight or final checks.
Explicit --provenance, --ignore-scripts, --tag and --registry avoid relying on
implicit defaults. Normal logging gives npm's diagnostics directly.

The current preparation already calculates SHA-512 for each archive but only
returns the model in memory; release-cli does not persist the returned model.
A tarball publisher needs a small saved manifest with relative archive paths,
versions, hashes, target tag and triggering commit, validated before publication.

The installed Sigstore 4.1.1 signer generates an ephemeral keypair in its signer
constructor; the high-level client sets fetchOnConflict false. A fresh signing
invocation can therefore create a different proof for the same archive. This is
the technical basis for investigating one fresh attempt, not proof of live
recovery or a claim that the lost acknowledgement cause is known.

Also checked the current pnpm registry release (12.8.1) and source tree. The
retained pnpm11 publishing implementation still has broad resolver-error catches;
the exact 12.x shipped command path was not established. Do not label an upgrade
as fixing these issues without testing that version's actual distributed CLI.

Skill lock/manifest applicability is inherited from the existing task's work
log. This turn checked the exposed skill descriptions, expected-skills manifest
and the two selected readable entrypoints; no new skills were installed.
