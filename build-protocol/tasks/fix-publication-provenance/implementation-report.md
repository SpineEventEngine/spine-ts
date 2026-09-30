# npm publication replacement implementation report

## Result

The release preparation saves a source-bound manifest for the exact 19 public
archives after packing and external-consumer proof. The publication job uses
the saved archives directly with pinned npm 11.16.0, explicit provenance,
disabled lifecycle scripts, public access, and the validated tag. Publication
is serial in runtime dependency order. No production registry write was run
during this implementation.

The release commands are:

- `node scripts/release-cli.mjs prepare --output <release-dir>`
- `node scripts/release-cli.mjs publish --input <release-dir> --report <path> [--prior-report <path>]`
- `node scripts/release-cli.mjs verify-registry --input <release-dir> --report <path>`

Preparation writes `<release-dir>/release-manifest.json`. The GitHub publish
job saves `publication-report.json` as a separate artifact, including on
publisher failure. On a rerun, it requires the prior report from the same
GitHub run before any npm invocation. Missing prior evidence stops writes.
The report binds the run ID, source SHA, version, tag, archive names, and
SHA-512 integrity values, and records every attempt as started before npm.

## Behavior implemented

- Validates saved SHA-512 values, actual archive names, package names, versions,
  internal runtime edges, source SHA, dependency order, and exact 19-package
  inventory before publication. Extra/missing archives and unsafe tar paths or
  links are rejected before extraction.
- Reads exact-version metadata and dedicated dist-tag endpoints. Missing
  versions are distinguished from denied, malformed, failed, and timed-out
  reads. Every package receives a preflight read before the first write.
- Rejects selected-tag rollback and existing packages without matching
  provenance before writing. Rechecks selected and opposite tags immediately
  before each npm invocation, including a second attempt. This reduces the
  stale-check window; npm does not offer an atomic tag comparison with publish.
- Accepts a retry only for npm JSON code `TLOG_CREATE_ENTRY_ERROR` plus the
  full pinned summary and detail text from the supplied log. Both must contain
  the same 80-character lowercase hexadecimal Rekor record ID. One package
  can receive at most two attempts across all job reruns. Generic TLOG,
  arbitrary 409, changed suffixes, and mismatched IDs stop without a retry.
- Uses distinct temporary empty user/global npm configuration files per
  attempt, removes token-like environment variables, and removes those files
  afterward. A harmless real `npm config get registry` smoke test passed with
  the resulting environment; no stored token fallback is configured.
- Records ambiguous npm outcomes as unconfirmed and reads exact-version state
  without resending. Positive integrity, tag, source, workflow, and provenance
  evidence can establish publication; a 404 cannot. Later package writes stop
  after an unresolved failure.
- Confirms package integrity, selected tag, preserved opposite tag, and npm
  SLSA provenance statement subject/digest, repository, master workflow,
  source dependency URI, and source commit. It uses one shared 60-second
  confirmation deadline. Missing records remain unconfirmed; contradictory
  records fail. The read-only verification command can confirm a fully
  published release without npm publication.
- Removes Lerna, its disposable workspace and extraction helpers, direct
  dependency, obsolete publisher and tests, and lockfile entries. The publish
  job no longer installs, rebuilds, or repacks after downloading the release
  artifact. The PR workflow runs the real-library Rekor reproduction.

## Five main preflight findings

1. **npm config collision:** replaced duplicate `/dev/null` paths with two
   distinct empty temporary files. The real pinned npm startup test passes.
2. **Retry cap across reruns:** the saved attempt count controls the loop.
   Two prior conflicts block another write; one prior conflict allows only one.
3. **Archive version:** archive inspection now returns its package.json version;
   publication compares it with the validated common release version.
4. **Interruption cleanup:** preparation again removes incomplete output on
   SIGINT/SIGTERM, with focused tests for both signals.
5. **35-line callable rule:** new/modified operational callables were measured
   after formatting and are within 35 physical lines. The two longer
   consumer-proof functions in snapshot-artifacts.mjs were unchanged.

## Independent review correction batch

1. An uncertain npm result now stops later uploads and reaches the shared
   read-only confirmation window. A delayed registry record can confirm it;
   the archive is never resent. An unresolved result leaves later packages
   not attempted and causes `executeRelease` to fail after confirmation.
2. Confirmation saves each changed package status immediately. A deadline
   between package reads cannot discard an earlier confirmed result.
3. Preparation compares each inspected archive version with the expected
   common version before saving the release manifest.
4. Persistent output creation now runs inside registered interruption
   handlers. An interruption during creation removes the new output, while an
   existing output is rejected and retained.
5. An exact-version 404 alongside any returned tag claiming that target
   version is rejected before npm, including the selected and opposite tags.
6. Manifest tampering tests now use a passing control, valid SHA and checksum
   for unrelated mutations, and an isolated checksum failure. Each mutation
   checks its intended rejection.
7. `createReleaseManifest` documentation now calls the JSON a saved manifest;
   npm/Sigstore signs the archive provenance during publication.

## Main integration correction

The exact-version 404 plus target-version tag contradiction is checked in
publication preflight, before npm. After an npm attempt, that same observation
is treated as incomplete read-only evidence: confirmation keeps the package
unconfirmed and waits within the existing shared deadline. A focused
regression observes the tag before exact-version metadata and provenance,
then confirms the package with one npm attempt and one bounded wait. The
selected-tag and opposite-tag preflight rejection tests still pass.

## Final review correction batch

1. Publication reports now record `runAttempt` beside `runId`. A writing rerun
   accepts only a valid report from the immediately preceding attempt, checks
   it before saving or invoking npm, and saves new evidence with the current
   attempt. An attempt 1 report cannot authorize attempt 3 if attempt 2 ended
   without uploading its report. Read-only report validation does not grant
   writing permission. The existing per-package two-attempt limit remains.
2. Read-only confirmation treats exact metadata visible before the selected
   tag as pending. It waits within the same shared deadline and never resends.
   Publication preflight still rejects that mismatch before npm. The earlier
   tag-first regression remains covered.
3. Provenance matching now requires the observed npm Sigstore bundle v0.3
   structure: DSSE payload type and non-empty encoded signature, certificate,
   log ID, transparency log body, and inclusion proof with checkpoint. Missing or malformed
   fields stay unconfirmed. The existing exact archive digest, source commit,
   repository, workflow and ref checks remain. These are structural and
   identity checks of npm-hosted records, not independent cryptographic
   verification. No new audit phase or dependency was added.
4. `pnpm why pacote nx -r --depth Infinity` found neither package. The
   lockfile had no pacote or nx package entry. The obsolete pacote override,
   Lerna-specific test and nx `allowBuilds` denial were removed. All other
   overrides and build permissions remain. Lockfile-only regeneration and a
   frozen install with scripts disabled succeeded.

## Verification

- `node --test scripts/npm-rekor-recovery.repro.mjs`: 1 passed. The file uses
  `npm root -g` to locate pinned npm and has a non-Vitest filename.
- `pnpm exec vitest run --maxWorkers=1` over the six release suites plus
  `scripts/snapshot-artifacts.test.mjs`: 7 files, 67 tests passed.
- Final six release suites after formatting: 6 files, 50 tests passed.
  Tests include the complete 19-package order, exact retry classification,
  rerun cap, ambiguous outcomes, tag checks, read-only confirmation, complete
  failure reports, and workflow handoff.
- Changed-file ESLint, `pnpm typecheck:tooling`, cleanup enforcement, TSDoc
  enforcement, Prettier check, and `git diff --check` passed.
- Lockfile-only update and then frozen install with scripts disabled succeeded.
  A lockfile scan found no Lerna package entry.
- After the independent review corrections, `pnpm exec vitest run
--maxWorkers=1` over `release-artifacts`, `release-cli`,
  `release-publication`, `release-registry`, `release-workflows`,
  `release-policy`, and `snapshot-artifacts` passed: 7 files, 74 tests. The
  three directly corrected suites also passed separately: 42 tests. An
  isolated manifest suite run passed: 13 tests.
- The post-correction cheap preflight passed: changed-file ESLint,
  `pnpm typecheck:tooling`, cleanup enforcement, TSDoc enforcement, Prettier
  check, and `git diff --check`. A TypeScript AST line count found no
  new/modified operational callable above 35 physical lines.
- After the main integration correction, the affected `release-cli` and
  `release-publication` suites passed together: 2 files, 29 tests. The new
  regression first failed at the reproduced contradictory-read guard, then
  passed after moving that guard to publication preflight. Changed-file ESLint,
  tooling typecheck, cleanup, TSDoc, Prettier, `git diff --check`, and the
  35-line operational callable check passed afterward.
- After the final review corrections, `pnpm exec vitest run --maxWorkers=1`
  over `release-publication`, `release-cli`, and `package-metadata` passed:
  3 files, 52 tests. The tests cover stale/malformed and immediate-prior
  attempt identity, the cap, both registry visibility orders, wrong tags before
  writes, and incomplete or malformed bundle material. Changed-file ESLint,
  `pnpm typecheck:tooling`, cleanup, TSDoc, Prettier, `git diff --check`, and
  the 35-line operational callable check also passed.

## Targeted security follow-up

Pinned npm's `@sigstore/bundle` v0.3 validator requires an inclusion proof
with a checkpoint and exactly one DSSE signature. The structural check now
requires those fields; an inclusion promise is optional and cannot replace the
proof. The npm-hosted record's package, source, workflow, digest, and tag
identity checks remain in place. No independent cryptographic verification or
new dependency was added. Focused regressions reject a missing proof even with
a promise, accept a complete proof-only bundle, and reject two signatures.

The post-follow-up `release-publication` and `release-cli` suites passed with
one worker: 2 files, 42 tests. Changed-file ESLint, tooling typecheck, cleanup,
TSDoc, Prettier, `git diff --check`, and the 35-line callable check passed.
Main will check a real npm response and conduct the final targeted check.

## Final required-field correction

The pinned npm `@sigstore/bundle` v0.3 validator also requires `kindVersion`
on each provided transparency log entry. The structural check now requires its
non-empty kind and version, and checks every entry rather than accepting one
valid entry beside a malformed sibling. Publication and CLI fixtures include
the field. Focused tests reject missing `kindVersion` and a malformed sibling;
the proof-only case still passes. `packageState` now documents `limitMs`.

The complete relevant validator field comparison was made against pinned npm:
media type, DSSE payload and exactly one non-empty signature, certificate
material, log ID and kind/version for each entry, and v0.3 inclusion proof with
checkpoint. The implementation additionally checks the expected npm payload
type and non-empty encoded log content. These remain structural checks, not
independent cryptographic verification.

After this correction, the affected suites passed with one worker: 2 files,
44 tests. Changed-file ESLint, tooling typecheck, cleanup, TSDoc, Prettier,
`git diff --check`, and the 35-line callable check passed. Main's
deterministic read-only check of the actual npm record and pinned parser remains.

No full build, coverage, verify:publish, real publication, commit, or push was
run in this implementer assignment. Main's broad documentation, decision
records, version commits, and unrelated worktree changes were preserved.

## Remaining limits

Local tests establish npm/Sigstore error classification and orchestration, not
live GitHub OIDC, Fulcio, Rekor, or npm publication. The read-only npm registry
sample confirmed the observed attestation URL and SLSA statement shape, but
public-record parsing is not a custom cryptographic verifier; npm and Sigstore
perform that validation at publication. Final affected re-review, full release
verification, and an authorized live publishing run remain with main. No
post-correction full build, coverage run, publication, commit, or push was
performed here.

## Dependency audit correction

The earlier full `verify:publish` run completed its build, checks, and 5,133
tests, then failed the dependency audit on transitive `@grpc/grpc-js@1.14.4`. That full
run predates this dependency correction and does not verify the final tree.
Official advisories GHSA-m9gg-hp2v-232j and GHSA-f596-whhp-79r4 identify
1.14.5 as patched.

Pinned pnpm's `audit --fix=update` found the patched transitive version but
also changed unrelated resolutions and 20 previously clean manifests. Those
manifest edits were restored from HEAD with `apply_patch`; the root Lerna
removal was retained. The lockfile was reconstructed from the restored
manifests and its pre-correction diff matched the recorded 37 added/3,144
removed lines against HEAD. Only five grpc version references and the verified
registry integrity were changed from that baseline. The final lockfile diff
against HEAD is 43 added/3,150 removed lines: prior Lerna pruning plus those
six grpc lines. No override, release-age exclusion, advisory suppression, or
other package resolution was added. All snapshot.19 versions and pins remain.

- `pnpm install --frozen-lockfile --ignore-scripts` passed.
- `pnpm audit:release` ran both workspace and production audits; each reported
  no known vulnerabilities.
- One-worker focused tests passed: 8 files, 86 tests across package metadata,
  release policy, Datastore storage/public API, GCE/GKE deployment settings,
  and message-board deployment configuration.
- Tooling typecheck, changed-file ESLint, cleanup, TSDoc, Prettier, and
  `git diff --check` passed. `pnpm why @grpc/grpc-js -r --depth Infinity`
  resolves one version, 1.14.5, through the existing logging and Datastore
  dependency paths.

No full build, workflow run, real publication, commit, or push was performed
for this dependency correction. Main ran the real-library regression and the
archive proof; the latter exposed the verifier issue described below.
Final-head PR CI will run both audits and the full release profile on the
corrected tree.

## Exact archive consumer correction

The actual release `prepare --check` archive proof reached the exact external
consumer, then stopped at `pnpm install --offline --ignore-scripts` because
`pg-protocol@1.16.1` was absent from the local store. The consumer compiler and
runtime proof had not started. The exact consumer now uses normal online
`pnpm install --ignore-scripts`; the manifest and workspace overrides still
route every framework dependency to its prepared `file:` archive. Isolation
inspection, the unchanged TypeScript consumer program, compiler run, HTTP
smoke check, and `finally` cleanup remain in the same order. The native-only
consumer helper was not changed.

The modified exact-consumer method was split into documented short operations
for manifest creation and program writing; each changed operational callable
is at most 35 physical lines. A focused command/archive regression passed:
1 test, with 17 unrelated snapshot tests skipped by the name filter. The
release CLI, artifact, and policy suites passed separately with one worker:
3 files, 31 tests. Changed-file ESLint, tooling typecheck, cleanup, TSDoc,
Prettier, and `git diff --check` passed. Main will rerun the real archive
proof; no full build, publication, commit, or push was performed for this
correction.
