# Release 3 verification result

`pnpm verify:release` exited **1** at `check:logging-containment`, before the coverage/test phase. Raw output and exit are preserved in `verify-release-3.log` and `verify-release-3.exit`. All earlier release gates passed: Node validation, Proto generation and checksums, generated build and tooling typechecks, ESLint, cleanup/TSDoc/copyright/time checks, format, API/audience/snippet docs, Buf lint, and generated-output check. The two later independent checks were run separately and passed: production dependencies and release readiness. No release tests or global coverage ran.

The logging scan reported one stale manifest binding: `server.managed_replica_closed_ipc` in `build-protocol/logging/containment-manifest.json` has no adjacent source marker in `packages/server/src/server/managed-server-application.ts`.

The complete catch-path finding batch is:

| Source                                                          | Finding locations                                                                                                                                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/server/src/server/managed-server-application.ts`      | `493:12` detached catch and sentinel fulfillment; `494:12` detached catch and sentinel fulfillment; `512:13` sentinel fulfillment; `551:10`, `1205:12`, `1383:10`, and `1798:10` each detached catch and sentinel fulfillment. |
| `packages/deployment/src/internal/backend-membership-kernel.ts` | `535:10` and `548:10` each detached catch and sentinel fulfillment.                                                                                                                                                            |
| `packages/auth/src/subscriptions/index.ts`                      | `1159:10` detached catch and sentinel fulfillment.                                                                                                                                                                             |

These are 9 detached/voided catches and 10 catch callbacks that fulfill a sentinel. The raw checker reported files and categories but no lines; locations above were independently mapped to its AST predicates without modifying source. This record classifies the deterministic gate only.

Independent check evidence is in `post-release-independent-checks.log`: production dependency policy passed, and release readiness reported 97 package imports, 55 package assets, and 457 relative Markdown links. Provenance at release invocation: source tree `4ac3b494f046f144f5b92daba78ba205644d1055`; lockfile Git blob `d4c4186a5d53b300883b89826df05578f4144c16`; lockfile SHA-256 `208f8a77f22da9858c4d143f50b43de09f81036ef065c1d87d7b6ea8d97ffcd3`.
