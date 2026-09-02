# Contributing to Spine TS

Spine TS is developed in
[`SpineEventEngine/spine-ts`](https://github.com/SpineEventEngine/spine-ts).
The `master` branch is protected and must not receive direct commits or pushes.

## Make a change

1. Fetch the latest `origin/master`.
2. Create a clearly named feature branch. Do not use the `codex/` prefix.
3. Make and verify the change on that branch.
4. Push the feature branch to `origin`.
5. A human contributor opens a pull request targeting `master` and waits for
   its checks. An agent does this only when explicitly instructed.
6. A human reviews and merges the pull request.

Do not use `armiol/spine-ts` as a remote or publication source.

## Versions and publication

Every merge to `master` starts the NPM publishing workflow. Coordinate the next
unused common version with the maintainer before opening a pull request.

A version-only commit may update all workspace manifests together. It changes
only their top-level `version` fields and uses this message:

```text
Bump version -> <version>
```

Update concrete internal dependency versions and `pnpm-lock.yaml` in a separate
commit. See the [NPM release runbook](docs/release-publishing.md) for the complete
release policy.

## Verify locally

Install the frozen dependency graph and run the task-appropriate verification:

```sh
pnpm install --frozen-lockfile
pnpm verify:task --no-tests
```

The command above is for documentation-only changes. Source changes require
explicit focused test paths and a coverage choice; follow the
[build protocol](build-protocol/BUILD_PROTOCOL.md#quality-gates). Changes to
shared runtime, packaging, or release behavior require `pnpm verify:release`
after focused checks and review converge.
