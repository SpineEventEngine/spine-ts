# Post-fixture dependency audit

Compared the current lockfile with `ec40b81e7:pnpm-lock.yaml`. The only importer change is `packages/server-blackbox-tests`, which adds workspace links for `@spine-event-engine/client-node`, `@spine-event-engine/client-web`, and `@spine-event-engine/server-test-fixtures`. All 31 importer paths remain present. Package resolution entries and snapshots have no additions, removals, or changes; there is no external dependency resolution change.

Current lockfile SHA-256: `9b142ea7ed339c8c1c25494ee380d9d57bd89949fdbcbcb4aa2065f5b2cd386b`.

Both audits completed against that lockfile with exit code 0 and reported no known vulnerabilities:

- `pnpm audit --audit-level=low` — `audit-all.log` / `audit-all.exit`.
- `pnpm audit --prod --audit-level=low` — `audit-prod.log` / `audit-prod.exit`.

No installation, source, manifest, or lockfile changes were made by this audit. The lock comparison and audit environment, including a discarded read-only wrong-checkout invocation, are recorded in adjacent `post-fixture-*` files.
