# Final release verification 6 result

Date: 2026-10-14

Branch: `sql-delivery-subscription-reliability`

HEAD: `f98d3845375b8abba345320f4954842dee6f2ee0`

Tree: `f3d95ad123f617c89ccf63bab64f2b562fa2a1ab`

Lockfile blob: `54fbe84dbe820dc1ac72f3b59970bc51e2469ace`

Lockfile SHA-256: `9b142ea7ed339c8c1c25494ee380d9d57bd89949fdbcbcb4aa2065f5b2cd386b`

The fresh 17-check preflight passed; see [preflight-7.md](preflight-7.md) and [preflight-7.log](preflight-7.log). The single `pnpm verify:release` invocation exited 0. Its complete output and exit marker are [verify-release-6.log](verify-release-6.log) and [verify-release-6.exit](verify-release-6.exit). Vitest reported 321 test files passed and 1 skipped (322 total); 5,391 tests passed and 3 skipped (5,394 total). No unhandled errors were reported. Vitest’s captured summary did not identify the reason for the skipped file or tests. Test duration was 623.83 seconds.

Global V8 coverage was:

| Metric     | Coverage | Covered / total |
| ---------- | -------: | --------------: |
| Statements |   93.30% | 24,917 / 26,704 |
| Branches   |   90.15% | 14,829 / 16,448 |
| Functions  |   92.97% |   6,344 / 6,823 |
| Lines      |   94.50% | 22,938 / 24,271 |

Branch coverage rose by 53 covered obligations versus release5 (14,776 to 14,829) and cleared the configured 90% threshold by 25 covered obligations. The report is available at `coverage/lcov.info` in the ignored generated coverage output.

Every process used `TMPDIR=/Users/armiol/.codex/worktrees/sql-delivery-reliability/spine-ts/.worktrees/sql-delivery-tmp`, outside `node_modules`. The tracked runtime path/blob manifest is [runtime-source-blobs-7.tsv](runtime-source-blobs-7.tsv), SHA-256 `1daf42964abeee10172844de37db58671ef9f4e6536a1703740deb3b5905b11d` (62 paths). Every runtime source blob matches release5 checkpoint `eda2063b416e88ebb22df39f290e799ab663c237`; no production source path changed in this coverage-test-only checkpoint. The lockfile blob and SHA-256 also match release5.
