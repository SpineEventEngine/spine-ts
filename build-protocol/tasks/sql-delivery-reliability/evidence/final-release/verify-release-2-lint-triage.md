# Release 2 ESLint triage

The release gate reached `eslint .` after Node validation, Proto generation, generated-build typecheck, and tooling typecheck. ESLint reported 6,602 errors and 5 warnings, then the gate exited 1. Later generated gates and release coverage/tests did not run. The complete machine output is preserved in `verify-release-2.log`.

Of the 6,602 errors, 6,585 errors and all 5 warnings came from generated local Playwright files beneath `evidence/runtime-tmp/browser-tools/venv/.../playwright/driver/package`. They are bundled JavaScript and declaration files, including parser-project errors. The directory was task-local temporary runtime output and has since been relocated outside the evidence tree. These diagnostics do not identify production source defects.

The other 17 errors affect six authored task evidence scripts:

| File                                                                                         | Diagnostics                                                                 |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `evidence/inbox-status-tenants.mjs`                                                          | Two `no-undef` errors for `URL` (21:32, 48:48).                             |
| `evidence/live-driver-causes.mjs`                                                            | Two `no-undef` errors for `URL` (22:32, 26:48).                             |
| `evidence/sql-trace/probe.mjs`                                                               | One `no-undef` error for `URL` (40:24).                                     |
| `evidence/transport-fault-correction-matrix/run-transport-fault-correction-matrix.mjs`       | `no-undef` for `setTimeout`/`clearTimeout`; `no-empty` at 80:109 and 95:15. |
| `evidence/transport-fault-matrix/run-transport-fault-matrix.mjs`                             | `no-undef` for `setTimeout`/`clearTimeout`; `no-empty` at 80:109 and 95:15. |
| `evidence/transport-publication-barrier-matrix/run-transport-publication-barrier-matrix.mjs` | `no-undef` for `setTimeout`/`clearTimeout`; `no-empty` at 80:109 and 95:15. |

No ESLint diagnostics mapped to production package files. This evidence only classifies the release failure; it does not change scripts or weaken lint configuration.
