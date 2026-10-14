# Final version freshness

As of 2026-10-14, official npm registry checks returned HTTP 404 for snapshot.23 across all 19 published workspace packages. The official `origin` tag query returned no matching refs. The current lockfile hash matches the post-fixture audit: `9b142ea7ed339c8c1c25494ee380d9d57bd89949fdbcbcb4aa2065f5b2cd386b`.

Snapshot.23 remains unused and valid. The check used the explicitly configured `gpt-6-luna` / `medium` profile; runtime model introspection is unavailable. Machine-readable results are in `final-version-freshness.json`.
