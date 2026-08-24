# NPM release runbook

NPM trusted publishing uses a short-lived GitHub Actions OIDC identity instead of
an npm token. Never add a token fallback.

1. Push a feature branch and open a pull request to `master`.
2. `build.yml` is read-only: it verifies and proves the packed artifacts.
3. A human merges the pull request.
4. `publish.yml` runs for the `master` push and publishes through OIDC.

Every merge may result in a release. Keep one version across the root, 18 public
packages, and seven examples. Implementing agents use a standalone commit named
`Bump version -> <version>`; concrete internal pins and `pnpm-lock.yaml` change
separately. Channel metadata (`publishConfig.tag`) changes separately when moving
between snapshot and stable releases.

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

On success, all packages become visible with their exact integrity and selected
tag. A transient registry or network failure may be resumed by rerunning the
same workflow for the same commit and version: matching packages skip and
missing packages resume in dependency order. A persistent or ambiguous failure
requires investigation. A fully published version fails deliberately.

For an integrity or tag mismatch, diagnose the cause and use a new version; do
not repack, overwrite, repair tags, unpublish, or reuse the affected version for
same-version mutation. Do not use tokens, login/whoami, or disable provenance.
Pause merges if the fixed queue approaches GitHub's 100 pending-run ceiling.
