# NPM release runbook

NPM trusted publishing uses a short-lived GitHub Actions OIDC identity instead of
an npm token. Never add a token fallback.

1. Push a feature branch and open a pull request to `master`.
2. `build.yml` is read-only: it verifies and proves the packed artifacts.
3. A human merges the pull request.
4. `publish.yml` runs for the `master` push through OIDC with pinned Lerna
   `10.0.1 publish from-package`.

Every merge may result in a release. Keep one version across the root, 18 public
packages, and seven examples. Implementing agents use a standalone commit named
`Bump version -> <version>`; concrete internal pins and `pnpm-lock.yaml` change
separately. `publishConfig.access` remains package metadata, but a static
`publishConfig.tag` is forbidden: the validated common version is the sole
channel source passed explicitly to Lerna.

Exact `x.y.z-snapshot.N` uses `snapshot`; exact `x.y.z` uses `latest`; every
other prerelease fails before mutation. The historical first published snapshot
is `2.0.0-snapshot.2`; `2.0.0-snapshot.4` remains unpublished until an
authorized official merge occurs.

In npm's UI, configure one trusted publisher for each package. Use organization
`SpineEventEngine`, repository `spine-ts`, filename `publish.yml` only,
environment `gh-actions-environment`, and allowed action `npm publish`. A package
has one trusted publisher; replacing it replaces that connection.

- `@spine-event-engine/auth`, `@spine-event-engine/client-node`, `@spine-event-engine/client-react`, `@spine-event-engine/client-web`, `@spine-event-engine/core`, `@spine-event-engine/delivery-client`
- `@spine-event-engine/delivery-server`, `@spine-event-engine/deployment`, `@spine-event-engine/deployment-gce`, `@spine-event-engine/deployment-gke`, `@spine-event-engine/proto`, `@spine-event-engine/proto-tools`
- `@spine-event-engine/server`, `@spine-event-engine/storage`, `@spine-event-engine/storage-datastore`, `@spine-event-engine/storage-rdbms`, `@spine-event-engine/testing`, `@spine-event-engine/transport`

Create `gh-actions-environment` before activation. Allow deployment from `master`
only, disable bypass, and leave required reviewers off by default so a merge can
release automatically. GitHub-hosted runners use Node 24, pnpm 11.9.0, and npm
11.16.0. Provenance remains automatic.

Before activation, protect `master`: require pull requests and successful PR
verification, prohibit direct pushes, and disable bypass. Repository code cannot
configure this environment or the 18 npm trusted publishers; an operator must
provide that configuration evidence before activation.

The workflow verifies packed contents and a fresh external consumer before
mutation, then publishes validated `.publish` directories. Lerna/npm repacks
those directories, so this proves semantic contents rather than byte identity.
A transient interruption may be resumed at the same version: Lerna skips
existing name/version pairs and publishes missing packages in dependency order.
The read-only preflight rejects a fully published version; an ambiguous registry
response requires investigation.

If final registry verification shows a missing version or selected tag, stop and
investigate; do not overwrite, repair tags separately, unpublish, or reuse the
affected version for same-version mutation. The migration does not compare a
published tarball's bytes with the staged tarball, and a partial rerun resumes
by package name/version rather than integrity. Do not use tokens, login/whoami,
or disable provenance. Pause merges if the fixed queue approaches GitHub's 100
pending-run ceiling.
