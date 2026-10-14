# Final release preflight 7

Date: 2026-10-14

Branch: `sql-delivery-subscription-reliability`

HEAD: `f98d3845375b8abba345320f4954842dee6f2ee0`

Tree: `f3d95ad123f617c89ccf63bab64f2b562fa2a1ab`

Lockfile blob: `54fbe84dbe820dc1ac72f3b59970bc51e2469ace`

Lockfile SHA-256: `9b142ea7ed339c8c1c25494ee380d9d57bd89949fdbcbcb4aa2065f5b2cd386b`

All 17 deterministic preflight checks passed. Raw output is in [preflight-7.log](preflight-7.log), with exit marker [preflight-7.exit](preflight-7.exit). Every process used `TMPDIR=/Users/armiol/.codex/worktrees/sql-delivery-reliability/spine-ts/.worktrees/sql-delivery-tmp`, outside `node_modules`.

| Check                                | Exit | Result |
| ------------------------------------ | ---: | ------ |
| `pnpm check:node`                    |    0 | Pass   |
| `pnpm format:check`                  |    0 | Pass   |
| `git diff --check`                   |    0 | Pass   |
| `pnpm typecheck:tooling`             |    0 | Pass   |
| `pnpm exec eslint .`                 |    0 | Pass   |
| `pnpm lint:cleanup`                  |    0 | Pass   |
| `pnpm lint:tsdoc`                    |    0 | Pass   |
| `pnpm lint:copyright`                |    0 | Pass   |
| `pnpm check:time-reads`              |    0 | Pass   |
| `pnpm docs:api:check`                |    0 | Pass   |
| `pnpm docs:audience:check`           |    0 | Pass   |
| `pnpm docs:snippets:check:generated` |    0 | Pass   |
| `pnpm proto:lint:generated`          |    0 | Pass   |
| `pnpm proto:check-generated:current` |    0 | Pass   |
| `pnpm check:logging-containment`     |    0 | Pass   |
| `pnpm check:production-dependencies` |    0 | Pass   |
| `pnpm check:release-readiness`       |    0 | Pass   |

The tracked runtime path/blob manifest is [runtime-source-blobs-7.tsv](runtime-source-blobs-7.tsv), SHA-256 `1daf42964abeee10172844de37db58671ef9f4e6536a1703740deb3b5905b11d` (62 paths). Every blob matches the preceding release checkpoint `eda2063b416e88ebb22df39f290e799ab663c237`; no production source path changed in this coverage-test-only checkpoint. The lockfile blob and SHA-256 also match release5.
