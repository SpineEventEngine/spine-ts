# Final versioning preparation

Role/function: orchestrator-dispatched package/version verification. Dispatch explicitly selected `gpt-6-luna` / `medium`. Runtime model introspection is unavailable in this surface; the explicit dispatch is the available profile evidence.

## Read-only inventory

- Worktree: `/Users/armiol/.codex/worktrees/sql-delivery-reliability/spine-ts`, branch `sql-delivery-subscription-reliability`, inspected HEAD `326da14dfecd9898e2335067f73f16dd83de438d`.
- `origin` is `git@github.com:SpineEventEngine/spine-ts.git`, which resolves to the official repository.
- `pnpm -r list --depth -1 --json` reports 31 workspace manifests. Every manifest currently has `2.0.0-snapshot.22`.
- The 19 non-private manifests are the publishable packages; the remaining 12 manifests are the root, examples, or test fixtures.
- The first inventory recorded 56 fixed `@spine-event-engine/*` pins, counting `@spine-event-engine/validation@2.0.0-snapshot.7`. A scoped package inventory corrected that result: 54 fixed dependencies/devDependencies plus one peer dependency point at workspace packages; the remaining validation package is separately published and is not in the 31 workspace manifests or the 19-package release set. `workspace:*` references are not fixed pins.
- Candidate version from `final-release-preparation.md`: `2.0.0-snapshot.23`. Immediately before the version-only mutation, direct official npm registry requests returned HTTP 404 for all 19 public packages, and `git ls-remote --tags origin '*snapshot.23*'` returned no matching refs. After the version commit and before the dependency-pin commit, the registry check was repeated with the same 19 HTTP 404 results and no matching origin tags. Raw responses from the first registry check are preserved in `registry-check-2.0.0-snapshot.23.json`; the repeated check is recorded in `registry-recheck-2.0.0-snapshot.23.txt`; the tag query output is preserved in `origin-tags-check-snapshot.23.txt`.
- The exact 31 manifest paths are in `manifests.txt`. After the parent released the manifest window, `set_workspace_version.py` changed only their top-level version strings to `2.0.0-snapshot.23`, preserving all other bytes.

## Permission and sequence gate

The parent released the dependency-pin/lockfile window after the version-only commit `7f66e7749` was pushed. The scoped change updated the 55 fixed workspace dependency/devDependency/peerDependency pins from snapshot.22 to snapshot.23; it preserves `@spine-event-engine/validation@2.0.0-snapshot.7` because the official registry confirms snapshot.23 is unpublished for that separately released package. pnpm 11.9.0 refreshed workspace install state and regenerated the lockfile. Comparison against the version-only commit confirms no package resolution or snapshot changes. Both all-dependency and production-only audits pass at the new lockfile hash; details and raw results are in `dependency-audit-summary.md` and adjacent audit files. No external dependency upgrades were performed.

## Raw inventory result

Command: `pnpm -r list --depth -1 --json`; summary: 31 workspace packages, all `2.0.0-snapshot.22` before mutation. Command: parse each workspace `package.json` and classify by `private`; summary: 19 public packages and 12 private manifests. Full paths are preserved in `manifests.txt`. Post-mutation semantic audit confirms all 31 now use `2.0.0-snapshot.23` with no other semantic manifest changes. `git diff --check` passed for all 31 manifests.
