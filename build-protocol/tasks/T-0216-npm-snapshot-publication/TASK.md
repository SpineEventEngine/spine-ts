# T-0216 NPM Snapshot Publication

## Status

Integrated and verified at
`origin/main@e72222053d20a8828ca63aa4c76d7c13dc9216b5`; follow-up review
corrections are owned by T-0217. The implementation and its tests performed no
NPM publication; the later manual snapshot.2 publication was a human operation
outside this task's automated execution.

## Classification

High-risk. This task changes all public package artifacts and release mechanics,
including interruption/resumption and credential-adjacent command execution.
It does not change runtime behavior, public TypeScript contracts, authentication,
or the remaining Wave 14 package/SPI boundaries.

## Scope

Publishability preparation for exactly the 18 framework workspaces under
`packages/*` at `2.0.0-snapshot.2`. The private root and seven private example
workspaces receive the same workspace version but remain unpublished. Publication
uses only the explicit `snapshot` distribution tag and is performed manually by
the human from a fresh checkout after this task.

No package is published by this task. No commit, tag, or push targets the
`spine-event-engine` remote. The disposable publisher and its usage instructions
remain outside tracked repository paths.

## Acceptance criteria

1. The exact 26 workspace manifests each receive one standalone version-only
   commit with message `Bump version -> 2.0.0-snapshot.2`, touching only that
   manifest and exactly one top-level version line; every commit is pushed
   immediately to the feature branch.
2. Concrete internal snapshot-1 dependency pins become snapshot-2 in later
   commits; `workspace:*` remains unchanged and the external validation package
   remains `2.0.0-snapshot.7`. The lockfile is updated separately.
3. Exactly the 18 framework manifests are public and contain the required public
   registry, access, snapshot tag, repository URL, and package-directory metadata.
   Root and example manifests remain private.
4. Permanent policy and packed-artifact tests prove the complete human-specified
   manifest, payload, target, dependency, license, and isolated-consumer behavior.
5. Reader documentation gives experimental snapshot installation instructions
   and contains no now-false unpublished/private-workspace claim.
6. Disposable external publishing files implement clean-checkout preparation,
   exact inventory/version/order validation, one release gate, tested tarballs,
   isolated consumer proof, explicit mutation, dependency visibility waits,
   integrity-safe resumption, inherited interactive 2FA, and cleanup on all exits.
7. Deterministic checks, one complete relevant specialist review wave, one
   consolidated correction batch, affected re-review, and a single final
   `verify:release` pass converge before integration.
8. The feature branch, integrated `main`, and any task tags are pushed only to
   `origin`; remote refs are mechanically confirmed. NPM remains untouched.

## Human-Imposed Requirements Ledger

- Publish all 18 framework packages and no root/example package.
- Use exact version `2.0.0-snapshot.2` and explicit tag `snapshot`, never
  unqualified `latest`.
- Preserve accidental internal TypeScript exports for this fast slice.
- Do not broaden into compiler, tooling, authentication, or SPI restructuring.
- The human runs `npm login --registry=https://registry.npmjs.org/`; the publisher
  never accepts, stores, prints, or manufactures credentials.
- The publisher never clones, changes versions, commits, tags, pushes, unpublishes,
  overwrites, or changes distribution tags.
