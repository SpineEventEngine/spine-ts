# Final release preflight, correction pass

Branch: `sql-delivery-subscription-reliability`

HEAD at start: `f2387e164c732d3ca34f7955d9dce51a38974013`

Date: 2026-10-14

All cheap preflight checks passed. The failed first attempt remains preserved in `preflight.log`; this correction pass is captured in `preflight-2.log`. Temporary output was directed to `evidence/final-release/runtime-tmp`.

| Check                                | Exit | Result                                                                                                    |
| ------------------------------------ | ---: | --------------------------------------------------------------------------------------------------------- |
| `pnpm check:node`                    |    0 | Pass                                                                                                      |
| `pnpm format:check`                  |    0 | Pass                                                                                                      |
| `git diff --check`                   |    0 | Pass                                                                                                      |
| `pnpm typecheck:tooling`             |    0 | Pass                                                                                                      |
| `pnpm lint:cleanup`                  |    0 | Pass                                                                                                      |
| `pnpm lint:tsdoc`                    |    0 | Pass                                                                                                      |
| `pnpm lint:copyright`                |    0 | Pass                                                                                                      |
| `pnpm docs:api:check`                |    0 | Pass                                                                                                      |
| `pnpm docs:audience:check`           |    0 | Pass                                                                                                      |
| `pnpm docs:snippets:check:generated` |    0 | Pass                                                                                                      |
| Focused affected tests               |    0 | 3 files, 13 tests passed: Orders load runner, Projects load runner, and project subscription wait helper. |

The earlier scoped coverage disposition remains at `subscription-coverage-disposition.md`; this preflight does not change its scope or replace release-wide coverage.
