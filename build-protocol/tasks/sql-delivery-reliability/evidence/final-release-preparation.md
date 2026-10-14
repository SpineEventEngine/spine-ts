# Final release preparation

Role/function: orchestrator-dispatched read-only mechanical/package preparation. The dispatch explicitly selected `gpt-6-luna` / `medium`; runtime model introspection is unavailable, so the explicit immutable dispatch is the available profile evidence.

## Repository and package state

- Worktree: `/Users/armiol/.codex/worktrees/sql-delivery-reliability/spine-ts`, branch `sql-delivery-subscription-reliability`; current inspected HEAD `326da14dfecd9898e2335067f73f16dd83de438d`. The worktree has concurrent task changes; no check was run against this moving state.
- `origin` resolves to `SpineEventEngine/spine-ts`. Read-only `git ls-remote` returned official `master` at `658da1cdddcb8fd40f9205b1c200abc3a58dd62e`, matching the assigned starting point. No fetch or push was done.
- The 31 pnpm workspace manifests all use `2.0.0-snapshot.22`. There are 55 fixed internal package pins in dependencies/devDependencies and one in peerDependencies (56 total); `workspace:*` references are not fixed pins. The lockfile was not changed.
- The candidate common version is `2.0.0-snapshot.23`. Direct read-only registry requests returned HTTP 404 for this version on all 19 public Spine packages. `git ls-remote` found no matching snapshot.23 tag. This is a candidate only: repeat the registry and ref checks immediately before versioning.

## Final command sequence

After runtime matrices, examples, reviews, corrections, and evidence have converged and the tree is frozen, run the mandatory cheap preflight:

```sh
pnpm check:node
pnpm format:check
git diff --check
pnpm typecheck:tooling
pnpm lint:cleanup
pnpm lint:tsdoc
pnpm lint:copyright
```

Resolve any findings in the existing implementation context, then run the repository release profile once at the converged endpoint:

```sh
pnpm verify:release
```

The script runs node-version validation, Proto generation, generated TypeScript/tooling checks, ESLint and repository policy/documentation/Proto/generated-cleanliness gates, and the complete Vitest coverage suite with one worker and a 15-second test timeout. It writes build/generated outputs; confirm their expected generated cleanliness as part of the gate. Do not substitute `verify:task`: this is a shared runtime/release change.

The standard release Vitest config excludes the explicitly opted-in infrastructure test inventory. Therefore the task's database/process matrices remain separately recorded evidence, not environment prerequisites for `verify:release`. Those matrix commands require their named `SPINE_TS_MATRIX_*`, `SPINE_TS_FAULT_*`, `SPINE_TS_TAKEOVER_*`, or `SPINE_TS_TRANSPORT_*` selectors and task-local SQL services from `evidence/databases.json`; do not set those selectors for the repository-wide release command. The database registry records PostgreSQL 16.15/18.6, MySQL 8.4.10, and MariaDB 11.4.13 as running on loopback at inspection time, with host-driver readiness passing. Service state must be rechecked before any later matrix run.

## Not run

No builds, installs, tests, formatting, release verification, database commands, version edits, lockfile edits, commits, fetches, or pushes were performed. Only this evidence note was added.
