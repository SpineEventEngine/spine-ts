# NPM release runbook

NPM trusted publishing uses a short-lived GitHub Actions OIDC identity instead of
an npm token. Never add a token fallback.

1. Push a feature branch; a human maintainer opens a pull request to `master`.
2. `build.yml` audits all and production dependencies before release verification,
   prepares the saved archives, and transfers them to a fresh Node-only job for
   an offline publication trial.
3. A human merges the pull request.
4. `publish.yml` runs for the `master` push. It uses npm `11.16.0` to publish
   the tested package archives with OIDC authentication and provenance.

Every merge may result in a release. Keep one version across the root, 21 public
packages, and seven examples. Maintainers make a standalone commit named `Bump
version -> <version>`; concrete internal pins and `pnpm-lock.yaml` change
separately. `publishConfig.access` remains package metadata, but a static
`publishConfig.tag` is forbidden: the validated common version is the sole
channel source passed explicitly to npm.

Exact `x.y.z-snapshot.N` uses `snapshot`; exact `x.y.z` uses `latest`; every
other prerelease fails before mutation. The historical first published snapshot
is `2.0.0-snapshot.2`. Every new `master` merge carries the next unused common
version. Resuming the original publishing run is a separate operation and is
allowed only under the recovery rules below.

In npm's UI, configure the GitHub trusted publisher for each package. Use organization
`SpineEventEngine`, repository `spine-ts`, filename `publish.yml` only,
environment `gh-actions-environment`, and allowed action `npm publish`.

- `@spine-event-engine/ai`, `@spine-event-engine/ai-vercel-ax`, `@spine-event-engine/auth`, `@spine-event-engine/client-node`, `@spine-event-engine/client-react`, `@spine-event-engine/client-web`, `@spine-event-engine/core`, `@spine-event-engine/delivery-client`
- `@spine-event-engine/delivery-server`, `@spine-event-engine/deployment`, `@spine-event-engine/deployment-gce`, `@spine-event-engine/deployment-gke`, `@spine-event-engine/proto`, `@spine-event-engine/proto-tools`
- `@spine-event-engine/server`, `@spine-event-engine/storage`, `@spine-event-engine/storage-datastore`, `@spine-event-engine/storage-postgres`, `@spine-event-engine/storage-mysql`, `@spine-event-engine/testing`, `@spine-event-engine/transport`

## Publishing a new package for the first time

[NPM requires the package to exist](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites)
before it can have a trusted publisher. Therefore, the first version of every
new package must be published once by a human maintainer. This is the only
exception to the rule against local npm login. Do not add an npm token to the
repository or to GitHub Actions.

The maintainer needs publish access to the npm organization and account-level
two-factor authentication. The repository's pinned npm `11.16.0` supports the
`npm trust` command used below.

Do this only after the pull request is otherwise ready to merge. The new package
uses exact versions of the other framework packages, so it may not be usable
until the same release has been published for the rest of the workspace.

The repository provides `scripts/publish-new-package.mjs` for the complete
procedure. Pass the directory of the new public package. For example:

```bash
pnpm release:publish-new-package packages/storage-postgres
```

The script:

1. Confirms that the directory is one of the repository's public packages and
   that the package does not already exist on npm.
2. Shows the exact package, version, and release tag, then asks the maintainer to
   type the package name before anything is published.
3. Runs `pnpm verify:publish` and prepares the same tested package archive used
   by CI.
4. Opens npm's browser-based login, publishes only the new package, and adds the
   `SpineEventEngine/spine-ts` `publish.yml` trusted publisher for
   `gh-actions-environment`.
5. Waits up to 10 minutes for npm's public package endpoint to expose the exact
   version, retrying every five seconds, and only then verifies the published
   release tag and trusted-publisher record.
   It then logs out of npm and deletes the temporary release files. The same
   cleanup runs if the script receives `SIGINT` or `SIGTERM`.

The script never adds an npm credential to the repository or GitHub Actions. If
publication succeeds but setup or public-readability confirmation does not
finish, rerun only the setup step. Recovery first inspects the trusted publisher:
it accepts the exact existing configuration, creates one only when none exists,
and stops without npm mutation for a conflicting or ambiguous configuration.
Recovery also requires the exact workspace version to be published:

```bash
pnpm release:publish-new-package --trust-only packages/storage-postgres
```

For command help, run `pnpm release:publish-new-package --help`.

After the script finishes, open the package settings on npmjs.com. Confirm that
the trusted publisher names `SpineEventEngine/spine-ts`, `publish.yml`, and
`gh-actions-environment`, allows `npm publish`, and then disallow token-based
publishing for the package. This final publishing-access setting remains a
manual npm account action.

After this local publication, bump every workspace package to the next unused
common snapshot before merging. Use the required version-only commit, then update
internal dependency pins and the lockfile separately. The manually published first
version does not have GitHub OIDC provenance and must not be reused by the
automated release. The merge publishes the new version of every public package,
including the new package, through GitHub Actions with provenance.

Create `gh-actions-environment` before activation. Allow deployment from `master`
only, disable bypass, and leave required reviewers off by default so a merge can
release automatically. GitHub-hosted runners use Node 24, pnpm 11.9.0, and npm
11.16.0. The publication command explicitly enables provenance.

## What the publishing job does

Preparation builds and tests the packages, creates their archives, and installs
those archives in a fresh consumer project. It saves the archives together with
their package names, versions, hashes and source commit. Preparation then reads
the saved release using the same checks as the publishing job, including
dependency order and archive contents. Pull requests and the publishing workflow
use the same preparation action, including frozen install, audits, verification,
the pinned npm/Rekor loopback fixture, and saved archive preparation. The PR
job downloads the archives into a fresh Node-only runner and runs the actual
preflight, publication, report, rerun, and read-only verification entrypoints.
Only registry HTTP responses and the network-producing `npm publish` subprocess
are replaced with strict local responses. The trial checks all 21 packages,
a partial failed attempt, the saved prior report on rerun, and read-only
verification. It proves that all 21 accepted uploads finish when none of the
new versions is publicly readable, and that a rerun skips accepted uploads
while they remain invisible. It also checks a delayed registry response body
during explicit verification, plus fatal permission and malformed responses.
It writes and rereads real reports. Unexpected URLs or npm arguments fail the
trial. Trial reports are
uploaded even on failure under the distinct `publication-trial-report` artifact;
they are never recovery evidence for a real publication run. No npm, Sigstore,
signing, or OIDC service request is
made by the trial. The publishing job checks the saved release again and passes
the same archives directly to npm; it does not rebuild or repack them.

This offline trial proves local release policy, archive handoff, argument and
configuration construction, and report handling. It cannot prove public npm
availability, trusted-publisher configuration, GitHub environment authorization,
or live provenance acceptance. CI dependency downloads, audits, and GitHub
artifact transfer still use their normal services.

The consumer test may download third-party dependencies from the registry.
Every framework package comes from the prepared local archives, and dependency
installation scripts remain disabled.

Before a first publication attempt, the job checks all 21 packages against
npm's public registry. A rerun skips public reads for validated accepted uploads.
Each registry GET has a 10-second request-and-body limit and at most three
attempts for temporary transport failures, HTTP 429, or HTTP 5xx, with short
delays between attempts. Exhaustion stops publication; it never establishes
that a package is absent. The job stops on authentication errors, permanently
unavailable or malformed responses, conflicting published content, or a release
tag that already points to a newer version.
Packages are published one at a time in dependency order. Each package's tag is
checked again immediately before its publication.

The workflow queues releases so they do not overlap. npm does not offer an
atomic "publish only if the tag has not changed" operation; a separate external
publisher could still change the tag between the check and the upload.

### The narrowly limited Rekor retry

Sigstore records provenance in Rekor, a public transparency log. An entry can be
accepted while its acknowledgement is lost. The library's repeated request can
then fail because the same entry already exists. See
[the upstream issue](https://github.com/sigstore/sigstore-js/issues/1708).

The script permits one fresh npm attempt only when the pinned npm version reports
the exact Rekor duplicate-entry error established by the local regression test.
At this point provenance generation has failed before npm uploads the package.
A fresh attempt creates new signing material. This is not a guarantee that an
unavailable external service will recover.

Other signing errors, registry conflicts, authentication failures and unknown
errors do not qualify. A second failure stops publication of later packages.
No dependency is patched, no Sigstore timeout is increased, and provenance is
never disabled.

### Publication and public verification reports

The job reports every package as published, already present, failed, unconfirmed,
or not attempted. A zero exit code from npm is durably recorded as an accepted
upload and marks that package published. The publishing command succeeds once
all packages were accepted or already present; it does not wait for newly
uploaded versions to appear in public registry reads.

The separate read-only `verify-registry` command checks public visibility of
the exact version, archive hash, selected tag, and npm-hosted provenance record,
including the package, source commit, and publishing workflow. Snapshot
publication must leave `latest` unchanged. This verification checks for the
provenance signature, certificate, and transparency-log proof. It trusts npm's
HTTPS endpoint; it does not independently verify the cryptographic signatures.

Public registry data can appear later than npm accepts an upload. Verification
uses one shared 60-second window for the release, not a separate minute for
each package. Temporary read failures leave the package unconfirmed and can be
revisited within that same window. Packages positively confirmed during this
verification are not reread while others remain pending. A previous upload
report alone is not fresh public confirmation. Missing evidence after that
window is reported as unconfirmed; it does not reverse an accepted upload or prove that
permissions are wrong. Verification never uploads a package or changes a tag.

### Recovering a failed run

Use the saved package report to distinguish packages that were never attempted
from packages whose upload result is uncertain. The report records an attempt
before npm starts and is saved even when the publishing step fails.

A failed publication job can resume only with its original archives and a valid
report from the immediately preceding attempt of the same run and source commit.
An older report cannot establish what happened during an intervening cancelled
attempt. A recorded accepted upload with a zero npm exit code is skipped on a
rerun even if its public version is still invisible. A saved pre-upload Rekor
conflict permits the documented fresh attempt only when its recorded npm exit
was nonzero and its diagnostics match the exact proven conflict. Remaining
packages retain the exact-version and tag checks before writes. An uncertain earlier
upload must first be positively confirmed: a later 404 does not authorize
sending the package again. Missing reports, different archive bytes, conflicting tags or
newer releases stop further uploads. A cancelled runner may leave no report;
that case also requires investigation rather than a blind retry. The workflow
keeps the `release` artifact for one day and `publication-report` for 14 days.
Having the report alone is not enough to resume after the archives expire.

When every package was accepted but public visibility is still pending, use the
read-only verification command described below. Do not rerun
preparation and assume newly created archives are identical. If the original
artifacts have expired, prepare a new common version unless equality with the
original hashes can be established.

Download and extract the original `release` artifact from the GitHub run into a
local directory, for example `./release`. It must contain `release-manifest.json`
and the package archives. Check out the same source commit, then run:

```bash
# Read public registry records; do not log in or publish anything.
node scripts/release-cli.mjs verify-registry \
  --input ./release \
  --report ./publication-verification.json
```

The report contains the result for every package. A successful check confirms
the expected public records; it does not change the failed GitHub run's status.
Missing or contradictory records still require investigation. The publishing
command is for the protected GitHub job, not a local fallback:

```bash
# Used by CI after validating the saved artifacts and any earlier attempt.
node scripts/release-cli.mjs publish \
  --input ./release \
  --report ./publication-report.json
```

For a subsequent attempt, CI also supplies
`--prior-report <previous-publication-report.json>`. Do not remove that report
to bypass recovery checks.

Before activation, protect `master`: require pull requests and successful PR
verification, prohibit direct pushes, and disable bypass. Repository code cannot
configure this environment or the 21 npm trusted publishers; an operator must
provide that configuration evidence before activation.

If final registry verification shows a missing version or selected tag, stop and
investigate. Do not overwrite a published version, repair tags separately or
unpublish. Resume the original run only when the recovery checks allow it.
Outside the documented first-package
publication procedure, do not use tokens, local login, or `npm whoami`, and do
not disable provenance. Pause merges if the fixed queue approaches GitHub's 100
pending-run ceiling.
