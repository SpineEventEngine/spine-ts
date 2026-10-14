# Process-fault smoke and preflight

The focused PostgreSQL 16, two-app-process smoke used four separate UUID databases. Each selected opt-in command exited zero, wrote `result.json` with `status: PASS`, and wrote `cleanup.json` with `databaseDropped: true` and no cleanup errors. Exact observations and earlier test-invalid RED runs are indexed in `process-fault-run-dispositions.md`.

| Scenario                     | Run ID                             | Result        | Measured boundary                                                                                                                                                                                            |
| ---------------------------- | ---------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `before-effect`              | `ae307174d7a646089000e0e4c2257430` | PASS, 31.57 s | Received OK Command Ack, Planning entry before effect killed, fresh-PID replay, all five states, Event bytes unchanged; Planning entered twice and every other method once.                                  |
| `after-save-before-ack`      | `2b6f78a8abb6452aae9f18580cd01946` | PASS, 31.74 s | SQL state saved; exact Inbox row pending after all old processes stopped; transactional exact-row audit recorded one committed acknowledgement after fresh-PID Planning replay; Event bytes unchanged.       |
| `partial-publication-repair` | `efa70c0b866d41e28387946f4f9f44b7` | PASS, 2.08 s  | Completed Planning prefix and three Staffing insert failures before all-app kill; eight concurrent same-ID repair outcomes `ADMITTED`, one actual entry per workflow method, original Event bytes unchanged. |
| `shared-volatile-loss`       | `72e41463dbcf49de8e9a7839d4e559a8` | PASS, 13.82 s | Seed SQL state/Event preserved; second received OK Command Ack and pending in-memory row followed by handler-entry gate and Delivery/app kill; second effect absent after restart and 12 seconds.            |

Command form for each row: `SPINE_TS_FAULT_PROVIDER=postgres16 SPINE_TS_FAULT_SCENARIO=<scenario> SPINE_TS_FAULT_PROCESSES=2 pnpm --filter @spine-event-engine/server-blackbox-tests test:process-faults`. PostgreSQL 18, MySQL 8.4, MariaDB 11.4, eight-process variants, and the final release profile remain pending. Subsequent review corrections and post-cleanup cold-process replay passed in final PostgreSQL 16 run `30208ac4a0674d8e8103c25266cd501f`; see the dispositions and targeted re-review reports.

Focused preflight after the last source change:

- `node --check packages/server-blackbox-tests/test-fixtures/project-process-faults.mjs`: exit 0.
- Touched-file ESLint and Prettier: exit 0; `scripts/stable-ci-suite.test.mjs` inventory: 4/4 pass after adding this opt-in test to the expected list.
- `pnpm typecheck:tooling`: exit 0. `pnpm lint:tsdoc`: exit 0. `git diff --check`: exit 0.
- The first `pnpm lint:cleanup` did **not** complete policy evaluation. `check-cleanup-rules.mjs` ran `git diff --unified=0 --find-renames 658da1cdddcb8fd40f9205b1c200abc3a58dd62e...HEAD` and `spawnSync` returned `ENOBUFS` against its 64 MiB buffer. The diff includes committed large matrix snapshot evidence (individual snapshots reach 12,210 lines). A focused RED test showed the checker requested irrelevant evidence patches. It now retains unrestricted rename classification but requests patch hunks in bounded groups for eligible audited source destinations only, and reads only eligible untracked source files. The focused case and complete cleanup-rules suite pass **156/156**, including existing modified-rename enforcement; `pnpm lint:cleanup` now exits zero with `Cleanup enforcement checks passed.`

The compact RED/GREEN command-output transcript for this tooling correction is in `process-fault-cleanup-tool-checks.log`.

The harness is test-only. The driver directly kills recorded child PIDs/process group, uses unique task resources, and does not modify production code or compiled runtime. The observed acknowledgement handler replay is at-least-once behavior across crash; the public repair outcome indicates admission, not recipient completion.
