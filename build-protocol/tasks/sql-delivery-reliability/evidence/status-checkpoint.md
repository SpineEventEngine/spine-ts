# STS-01 status-filter checkpoint

Focused command: `pnpm exec vitest run packages/server/test/delivery/inbox-provider-status.test.ts` with one dedicated provider URL per invocation. Each invocation exited 0 with 2 passed / 1 skipped (memory plus selected SQL provider); full command output is in the named log.

| Provider | Local endpoint | Output |
| --- | --- | --- |
| PostgreSQL 16 | `127.0.0.1:63580` | `status-pg16.log` |
| PostgreSQL 18 | `127.0.0.1:63609` | `status-pg18.log` |
| MySQL 8.4 | `127.0.0.1:63610` | `status-mysql.log` |
| MariaDB 11.4 | `127.0.0.1:63612` | `status-mariadb.log` |

After the final status-validation and domain-fixture correction, TypeScript build, cleanup enforcement, TSDoc enforcement, touched-file ESLint, touched-file Prettier, and `git diff --check` each exited 0. Full outputs: `status-{typecheck,cleanup,tsdoc,eslint,format,diff}.log`.

The earlier focused four-file suite passed 104 tests with two SQL caller cases skipped when no provider URL was set. SQL adapter suites passed 96 tests. Those commands preceded the final caller-only correction; the final correction was rechecked by the four live-provider runs above.
