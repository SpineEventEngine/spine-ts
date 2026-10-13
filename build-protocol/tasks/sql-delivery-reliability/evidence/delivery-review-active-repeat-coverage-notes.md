# Active-repeat queue coverage

`pnpm exec vitest run packages/server/test/delivery/delivery-supervisor.test.ts --coverage --coverage.include packages/server/src/delivery/delivery-supervisor.ts --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=0 --reporter=dot`

Result: 52/52 tests pass. The focused source file has 213/220 lines and 154/167 branch arms covered. The four branch arms introduced by the finite pending scan all ran: `#startNext` line 652 capacity-full/available 1/9; line 653 active/inactive pending shard 2/7. The global 90% release coverage gate was not run here; threshold overrides apply only to this one-file diagnostic.

The RED test was run in a separate process group under an external 12-second watchdog, which terminated only that process group. The same test exited zero under that watchdog after the fix. Logs: `delivery-review-active-repeat-red.log`, `delivery-review-active-repeat-green.log`, and `delivery-review-active-repeat-coverage-final.log`.
