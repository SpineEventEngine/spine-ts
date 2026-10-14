# Dependency pin and audit result

The version-only commit `7f66e7749` set every workspace manifest to `2.0.0-snapshot.23`. This separate step changed 55 fixed dependency, devDependency, and peerDependency specifiers that point to workspace packages. The 55 values are listed by manifest in `pin-manifests.txt`; all other workspace references remain `workspace:*`.

The earlier count of 56 fixed internal pins was overinclusive. `@spine-event-engine/validation@2.0.0-snapshot.7` is a separately published non-workspace package. The official registry returns HTTP 200 for snapshot.7 and HTTP 404 for snapshot.23, so its pin and lock resolution remain at snapshot.7. This avoids changing a dependency to an unpublished version.

After regenerating the lockfile with pnpm 11.9.0 and refreshing local workspace install state, the lockfile SHA-256 is `208f8a77f22da9858c4d143f50b43de09f81036ef065c1d87d7b6ea8d97ffcd3`. Comparing with commit `7f66e7749` shows 20 changed importer sections, limited to internal workspace dependency specifiers. Package resolution entries and snapshots have no additions, removals, or changes. No external dependency resolution changed; detailed machine-readable delta is in `dependency-resolution-delta.json`.

Both fresh pnpm audit profiles passed with exit code 0 and reported no known vulnerabilities:

- `pnpm audit --audit-level=low` — all dependencies.
- `pnpm audit --prod --audit-level=low` — production dependencies.

Raw output and exit codes are in `audit-all.log`, `audit-all.exit`, `audit-prod.log`, and `audit-prod.exit`. No advisories were returned, so advisory paths and dependency-path classification do not apply. This point-in-time audit is scoped to the recorded lockfile hash.
