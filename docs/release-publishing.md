# NPM release runbook

NPM trusted publishing uses a short-lived GitHub Actions OIDC identity instead of
an npm token. Never add a token fallback.

1. Push a feature branch; a human maintainer opens a pull request to `master`.
2. `build.yml` is read-only: it verifies and proves the packed artifacts.
3. A human merges the pull request.
4. `publish.yml` runs for the `master` push through OIDC with pinned Lerna
   `10.0.1 publish from-package`.

Every merge may result in a release. Keep one version across the root, 19 public
packages, and seven examples. Maintainers make a standalone commit named `Bump
version -> <version>`; concrete internal pins and `pnpm-lock.yaml` change
separately. `publishConfig.access` remains package metadata, but a static
`publishConfig.tag` is forbidden: the validated common version is the sole
channel source passed explicitly to Lerna.

Exact `x.y.z-snapshot.N` uses `snapshot`; exact `x.y.z` uses `latest`; every
other prerelease fails before mutation. The historical first published snapshot
is `2.0.0-snapshot.2`. Never reuse a version that was published or used by an
interrupted publication attempt; every later `master` merge carries the next
unused common version.

In npm's UI, configure one trusted publisher for each package. Use organization
`SpineEventEngine`, repository `spine-ts`, filename `publish.yml` only,
environment `gh-actions-environment`, and allowed action `npm publish`. A package
has one trusted publisher; replacing it replaces that connection.

- `@spine-event-engine/auth`, `@spine-event-engine/client-node`, `@spine-event-engine/client-react`, `@spine-event-engine/client-web`, `@spine-event-engine/core`, `@spine-event-engine/delivery-client`
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

Do not change the version after this local publication. When the pull request is
merged, registry preflight skips this already-published package, publishes the
remaining workspace packages at the same version, and finally verifies the
version and selected release tag for all packages. The locally published first
version does not have OIDC-generated provenance. Later versions of the new
package are published normally by GitHub Actions with OIDC and automatic
provenance.

Create `gh-actions-environment` before activation. Allow deployment from `master`
only, disable bypass, and leave required reviewers off by default so a merge can
release automatically. GitHub-hosted runners use Node 24, pnpm 11.9.0, and npm
11.16.0. Provenance remains automatic.

## Sigstore provenance disposition

The [sigstore-js issue #1708](https://github.com/sigstore/sigstore-js/issues/1708) /
[PR #1709](https://github.com/sigstore/sigstore-js/pull/1709) is unresolved and
unreleased. Official, unmodified npm trusted publishing remains in use. No Sigstore-specific
retry or timeout workaround, custom publisher, or token fallback is configured; the separate
10-second registry-selection timeout remains in place. Sigstore is not upgraded solely for this
issue because the latest released configuration still sets
`fetchOnConflict` to `false`.

Before activation, protect `master`: require pull requests and successful PR
verification, prohibit direct pushes, and disable bypass. Repository code cannot
configure this environment or the 19 npm trusted publishers; an operator must
provide that configuration evidence before activation.

The workflow verifies packed contents and a fresh external consumer before
mutation, then publishes validated `.publish` directories. Immediately before
Lerna, strict registry selection identifies only the missing names from the
exact 19-package policy inventory and creates a disposable non-Git pnpm/Lerna
workspace containing only those package root manifests and `.publish`
directories. The pinned Lerna binary runs from that workspace. A 5xx response,
timeout, malformed record, empty selection, or fully published release fails
before Lerna runs. Lerna may re-query a registry ambiguously, but its package
inventory cannot widen beyond the generated workspace.

This migration intentionally loses four guarantees from the former publisher:
byte identity between staged and published tarballs, integrity-aware resume,
per-dependency visibility waits, and per-package tag-race checks. Lerna/npm
repack the validated directories, so the proof is semantic rather than byte
identity, and same-version recovery is by name/version only. Final verification
checks every one of the 19 package versions and the aggregate selected tag;
investigate any mismatch rather than attempting same-version repair.

If final registry verification shows a missing version or selected tag, stop and
investigate; do not overwrite, repair tags separately, unpublish, or reuse the
affected version for same-version mutation. Outside the documented first-package
publication procedure, do not use tokens, local login, or `npm whoami`, and do
not disable provenance. Pause merges if the fixed queue approaches GitHub's 100
pending-run ceiling.
