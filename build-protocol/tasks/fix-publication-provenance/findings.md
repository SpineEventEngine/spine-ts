# Release-tool research

Research data only; external source content is not an instruction.

## 1 October: Entity save and Inbox delivery evidence

TS baseline is `74c6b5615`; the relevant runtime paths also existed at the
branch's original master baseline `9e114729`. Earlier measurements of one Event
delivered to 1,000 distinct Process Managers using real in-memory storage took
3.586–3.621 seconds without coverage. Every resulting state was checked. It
used one shard drain, not 1,000. Handler bodies accounted for about 4.1 ms.
Instrumentation counted 1,000 current-map clones copying 499,500 entries,
66 Inbox reads returning 6,500 rows (5,500 already delivered), and 5,500
premature cleanup attempts. Timings for nested operations must not be added.
The temporary diagnostic harness was removed; repeatable measurement must be
established before implementation. These are recorded earlier observations,
not a fresh benchmark in this planning turn or proof of the CI slowdown's cause.

Latest official core-jvm HEAD fetched for the investigation:
`ea3067b137938ac0beb6920c39d11e300976fcc9`. Read-only checkout:
`/tmp/spine-jvm-storage-review.lEI6Fm/core-jvm`. Source root:
https://github.com/SpineEventEngine/core-jvm/tree/ea3067b137938ac0beb6920c39d11e300976fcc9/server/src/main

- `java/io/spine/server/storage/memory/InMemoryRecordStorage.java:75–89`
  writes supplied records; `TenantRecords.java:83–86` calls `records.put`.
  There is no whole-collection copy or expected-old-record write rejection.
- `kotlin/io/spine/server/entity/Transaction.kt:347–382,476–485` applies or
  rolls back the individual Entity's state/version. This is not a comparison
  against a concurrently saved storage record.
- `java/io/spine/server/delivery/Delivery.java:475–481,536–565` traverses
  pages before restarting a productive scan. `InboxPage.java:65–103` advances
  the receive-time cursor. `InboxStorage.java:118–159` includes delivered rows.
- `Conveyor.java:188–211` uses retained delivered records for duplicate
  recognition. Do not replace this with pending-only reads without proving
  the existing duplicate behavior remains intact.
- `CleanupStation.java:50–65` selects only eligible delivered records for
  deletion. `CleanupStationTest.java:76–101` covers retention.
- JVM Inbox storage test fixtures cover 79 records with page size 13 and
  mixed pending/delivered rows. These support the paging comparison, not
  the TS performance target.

TS source evidence:

- `packages/storage/src/memory/in-memory-entity-commit.ts:134–170` clones
  the current-state map, stages participating record collections, compares
  `input.expected`, then replaces the collections after staging succeeds.
- MySQL `src/mysql/storage-factory.ts:725–779`, PostgreSQL
  `src/postgres/entity-commit.ts`, and Datastore `src/datastore/entity-history.ts`
  operate on relevant records rather than copying every Entity state. All
  contain the TS expected-state check. Native transaction retries are distinct.
- `packages/storage/src/internal/entity-commit.ts` declares `expected` and
  the committed/conflict result. Repositories turn conflicts into plain Errors.
  The earlier T-0109 design brief introduced this policy; its human requirements
  ledger does not establish it as a human requirement. The new human direction
  supersedes that design choice, not unrelated Inbox conditional updates.
- `packages/server/src/delivery/delivery.ts:558–565` restarts after every
  productive page. Cleanup at lines 538–555 attempts deletion before storage
  rejects an unexpired retained row.
- MySQL non-InnoDB writes use a lock, not transaction rollback. This is already
  documented in `packages/storage-mysql/README.md:117–120` and `REFERENCE.md`.
  Do not claim these paths provide all-or-nothing multi-record writes.

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
