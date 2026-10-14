# Final release verification 5 result

Date: 2026-10-14

Branch: `sql-delivery-subscription-reliability`

HEAD: `eda2063b416e88ebb22df39f290e799ab663c237`

Tree: `bcc4611406d8f7894ba4d5d67003dcab96dde590`

Lockfile blob: `54fbe84dbe820dc1ac72f3b59970bc51e2469ace`

Lockfile SHA-256: `9b142ea7ed339c8c1c25494ee380d9d57bd89949fdbcbcb4aa2065f5b2cd386b`

The fresh 17-check preflight passed; see [preflight-6.md](preflight-6.md) and [preflight-6.log](preflight-6.log). The single `pnpm verify:release` invocation exited 1. Its complete raw output and exit marker are [verify-release-5.log](verify-release-5.log) and [verify-release-5.exit](verify-release-5.exit). All tests passed or were skipped: 320 test files passed and 1 was skipped; 5,357 tests passed and 3 were skipped, out of 5,360. No unhandled errors were reported. Test duration was 624.01 seconds.

V8 coverage was generated. Global coverage was:

| Metric     | Coverage | Covered / total |
| ---------- | -------: | --------------: |
| Statements |   93.16% | 24,878 / 26,704 |
| Branches   |   89.83% | 14,776 / 16,448 |
| Functions  |   92.97% |   6,344 / 6,823 |
| Lines      |   94.38% | 22,908 / 24,271 |

The release gate failed because branch coverage was 89.83%, below the configured 90% global threshold. The other three coverage metrics exceeded the threshold. The report is available at `coverage/lcov.info` in the ignored generated coverage output.
The 90% branch target is 14,804 covered obligations out of 16,448; the observed 14,776 leaves a 28-obligation gap at the current denominator. The mechanical changed-source candidate inventory is in [branch-candidates-5.md](branch-candidates-5.md) and [branch-candidates-5.json](branch-candidates-5.json): 45 files have uncovered branches, with 823 uncovered branch obligations across 61 files with LCOV records. Review candidate source paths and branch conditions before choosing tests; the inventory itself does not prescribe tests.

All processes used `TMPDIR=/Users/armiol/.codex/worktrees/sql-delivery-reliability/spine-ts/.worktrees/sql-delivery-tmp`, outside `node_modules`. The tracked runtime source path/blob manifest is [runtime-source-blobs-6.tsv](runtime-source-blobs-6.tsv), SHA-256 `1daf42964abeee10172844de37db58671ef9f4e6536a1703740deb3b5905b11d` (62 changed, present-at-HEAD source files under `packages` and `examples`; test and fixture paths excluded). No source edits were made during this verification.
