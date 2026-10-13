# Primitive/CAS changed-branch inspection

`independent-coverage.log` is a focused V8 coverage run of both full record-storage unit suites: 104/104 tests passed. It covers only the two changed SQL adapter source files, with global thresholds disabled for this diagnostic run.

The two entire files show 81.3% branches (448/551). This includes older query, schema, history-coordinator and table-inspection branches outside this checkpoint. To inspect the changed paths, each added-line range in `git diff --unified=0` for the two production files was intersected with `BRDA` entries in `coverage/lcov.info`. The changed lines contain 66 instrumented branches; 66/66 have positive hit counts (MySQL 38/38, PostgreSQL 28/28). This is a focused changed-line branch observation, not the repository release coverage gate.

The extra focused cases cover absent deletion, guarded deletion success/miss, first-writer collision, semantic-equivalent raw encoding, finite guard and immutable-insert exhaustion, unrelated uniqueness errors, a deadlock retry, and non-Error failures. Live provider runs separately check competing claims, partial Event batch prefixes, and immutable collision behavior.
