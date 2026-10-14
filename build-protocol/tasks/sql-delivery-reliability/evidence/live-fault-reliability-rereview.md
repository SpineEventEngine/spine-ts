# Live Inbox fault targeted reliability re-review

2026-10-14. Existing `performance_reliability_reviewer`, original explicit `gpt-6-sol` / `medium`, Standard profile retained. Actual runtime model/reasoning metadata is unavailable; no visible mismatch. Read-only targeted review of the two accepted test corrections. No builds, tests, databases, processes, or production edits. Supplied cleanup RED and GREEN establish the regression; corrected live suites pass 7/7 on PostgreSQL 16/18, MySQL 8.4, and MariaDB 11.4. Reported typecheck, ESLint, format and diff checks pass.

Both P2 findings are **resolved**. `inbox-provider-faults.integration.test.ts:171-205` captures the SQL cause and forbidden repeat outcome inside the monitor, then asserts both after `run()` returns, outside production's contained callback. The handler count, durable UPDATE count, and pending/removed row checks remain. `:271-281` retains the test error and cleanup errors; `releaseSqlResources` at `:284-318` attempts factory close, SQL connection close, exact UUID database drop, and admin close independently. Its focused regression makes both early closes fail and verifies the precise drop still runs and both failures are retained.

No directly caused residual reliability finding. The injected deadlock-class signal remains a controlled fault, and this suite does not claim an engine lock cycle or process crash.
