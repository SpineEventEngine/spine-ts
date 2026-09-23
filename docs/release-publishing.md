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
- `@spine-event-engine/server`, `@spine-event-engine/storage`, `@spine-event-engine/storage-datastore`, `@spine-event-engine/storage-postgres`, `@spine-event-engine/storage-rdbms`, `@spine-event-engine/testing`, `@spine-event-engine/transport`

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

The example below uses `storage-postgres`. Change `package_directory` when
bootstrapping another package.

```bash
set -euo pipefail

package_directory="packages/storage-postgres"
package_name="$(node -p "require('./${package_directory}/package.json').name")"
package_version="$(node -p "require('./${package_directory}/package.json').version")"
release_tag="$(node scripts/release-cli.mjs tag)"
archive_name="${package_name#@}"
archive_name="${archive_name/\//-}-${package_version}.tgz"
release_directory="$(mktemp -d "${TMPDIR:-/tmp}/spine-first-publication.XXXXXX")"
logged_in=false

cleanup() {
  if [[ "$logged_in" == true ]]; then
    npm logout --registry https://registry.npmjs.org/ || true
  fi
  rm -rf "$release_directory"
}
trap cleanup EXIT

# Run the same checks used by the publication workflow.
pnpm verify:publish

# Build and test all release archives. Publish the prepared archive, not the
# package directory, so the local publication uses the artifact already proved
# by the repository release tooling.
node scripts/release-cli.mjs prepare --output "$release_directory/release"
package_archive="$release_directory/release/$archive_name"
test -f "$package_archive"

# Stop if the package already exists. An E404 response is expected for a package
# that has not been published before.
npm ping --registry https://registry.npmjs.org/
if npm view "$package_name" name \
  --registry https://registry.npmjs.org/; then
  echo "$package_name already exists; do not repeat its first publication." >&2
  exit 1
fi

# Sign in through npm's browser-based login. This creates a local session only;
# no credential is added to the repository or to GitHub Actions.
npm login --registry https://registry.npmjs.org/
logged_in=true

# The first publication creates the public package in the organization scope.
npm publish "$package_archive" \
  --access public \
  --tag "$release_tag" \
  --registry https://registry.npmjs.org/

# Authorize the normal master workflow immediately after the package exists.
npm trust github "$package_name" \
  --repository SpineEventEngine/spine-ts \
  --file publish.yml \
  --environment gh-actions-environment \
  --allow-publish \
  --yes

# Check both the published version and the trusted-publisher record before
# removing the local npm session.
npm view "$package_name@$package_version" version \
  --registry https://registry.npmjs.org/
npm trust list "$package_name" --json
npm logout --registry https://registry.npmjs.org/
logged_in=false
```

After logging out, open the package settings on npmjs.com. Confirm that the
trusted publisher names `SpineEventEngine/spine-ts`, `publish.yml`, and
`gh-actions-environment`, allows `npm publish`, and then disallow token-based
publishing for the package.

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
