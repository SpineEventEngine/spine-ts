# Final release preflight, ESLint correction pass

Branch: `sql-delivery-subscription-reliability`

HEAD: `2456823f2ec240634dab6436753ede73931aa5e1`

Date: 2026-10-14

All required cheap checks passed. Full output is in `preflight-4.log`; all temporary output was directed to the ignored worktree-local `node_modules/.cache/sql-delivery-runtime-tmp` directory.

| Check                                | Exit | Result                                                                                                    |
| ------------------------------------ | ---: | --------------------------------------------------------------------------------------------------------- |
| `pnpm check:node`                    |    0 | Pass                                                                                                      |
| `pnpm format:check`                  |    0 | Pass                                                                                                      |
| `git diff --check`                   |    0 | Pass                                                                                                      |
| `pnpm typecheck:tooling`             |    0 | Pass                                                                                                      |
| `pnpm exec eslint .`                 |    0 | Pass                                                                                                      |
| `pnpm lint:cleanup`                  |    0 | Pass                                                                                                      |
| `pnpm lint:tsdoc`                    |    0 | Pass                                                                                                      |
| `pnpm lint:copyright`                |    0 | Pass                                                                                                      |
| `pnpm docs:api:check`                |    0 | Pass                                                                                                      |
| `pnpm docs:audience:check`           |    0 | Pass                                                                                                      |
| `pnpm docs:snippets:check:generated` |    0 | Pass                                                                                                      |
| Focused affected tests               |    0 | 3 files, 13 tests passed: Orders load runner, Projects load runner, and project subscription wait helper. |

This preflight does not replace the release-wide tests and coverage gate. Existing bounded coverage remains documented in `subscription-coverage-disposition.md` and related review evidence.
