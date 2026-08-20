# T-0215 evidence

## RED evidence

- Direct reproduction: three overlapping
  `DurableSubscriptionBindings.purgeExpired(1)` calls made the third operation
  reject `binding-busy`.
- Retained durable regression originally failed at that third rejection.
- Retained Gateway regression originally exposed raw pre-operation maintenance
  contention instead of the intentional `binding-busy` result.
- Retained public-mode tests originally failed because the Gateways always
  required a session resolver and Message Board fabricated a five-minute
  `ResolvedSession`.
- Deterministic lifecycle REDs covered pending activation expiry, cleanup retry,
  synchronous abort, active-stream termination, malformed backend failure, and
  missing Authorization handling.

## Focused green evidence

- Auth, server, durable binding, NodeCoordinator, Stand, and browser regression
  wave: 334 tests passed.
- Earlier combined framework regression wave: 229 tests passed; later browser
  and server wave: 175 tests passed.
- Message Board app: 58 tests passed; web: 39 tests passed; interop/lifecycle:
  7 tests passed; deployment/static contracts: 11 tests passed.
- Auth, Server, Message Board app, and Message Board web TypeScript checks
  passed.
- TSDoc enforcement, API inventory, docs audience, formatting, ESLint, and diff
  hygiene passed at the recorded checkpoints.
- Affected-module coverage: 94.63% statements, 90.70% branches, 92.81%
  functions, and 96.68% lines.
- Exact changed-production intersection against baseline, including the final
  behavior changes: 125/128 lines (97.66%) and 129/143 branches (90.21%).
- Proto diff against the baseline is empty after removal of the invalid
  durable-public experiment.

## Live browser and shutdown evidence

- Command:
  `MESSAGE_BOARD_STABILITY_OBSERVATION_MS=310000 PLAYWRIGHT_REUSE_EXISTING_SERVER=true pnpm --dir examples/message-board/web exec playwright test -c test/browser/playwright.config.ts --project chromium --grep "keeps two stock browser tabs live" --reporter=line`
- Result: 1/1 passed in 5.2 minutes.
- Both tabs received eight alternating posts, stayed `Updating live` for 310
  seconds, and both received the post sent afterward.
- During the healthy observed interval: zero `SubscriptionService.Cancel`
  responses, HTTP 500, HTTP 401, HTTP 404, and console errors.
- Before shutdown the launcher owned Coordinator PID 13643, replica PIDs 13647
  and 13648, Gateway PID 13653, Vite PID 13678, and exact Datastore and Delivery
  container IDs.
- Real Ctrl-C returned exit 130 and printed both exact removed container IDs.
  Subsequent process, listener, and container audits found no owned resource and
  no listener on 5173, 8081, 8090, 8091, or 8484.

## Documentation evidence

- `pnpm docs:audience:check` passed.
- `pnpm docs:api:check` passed with 106 expected Auth and 247 expected Server
  exports.
- Read-only documentation audit used explicit `gpt-5.6-luna` / `medium`; runtime
  telemetry was unavailable. Its accepted findings corrected public admission,
  session-only activation wording, pending-handshake versus active-stream
  lifetime, authenticated durable purge, and reconnect semantics.

## Specialist correction evidence

- Exact bounded-purge regression passed after first reproducing 26 removals
  instead of 25.
- Exact public-binding validation regression passed after first reproducing
  acceptance of the invalid configuration.
- `pnpm typecheck:tooling` passed with compile-time XOR proofs.
- `pnpm typecheck:build:generated` passed.
- Affected Auth/Server wave: 300/300 tests passed.
- Type-aware ESLint over every baseline-to-worktree TypeScript/JavaScript file
  passed after deterministic test-fixture corrections.

## Final affected re-review correction evidence

- RED: after a failed active purge at cutoff `1`, a concurrent cutoff `2`, and
  a retry at cutoff `1`, only `expired-1` was cleaned. GREEN: the retained
  cutoff makes the retry clean `expired-1` and `expired-2`.
- Focused durable/Auth/Browser/provider example suite: 83 tests passed.
- Generated build and tooling typechecks passed. TSDoc enforcement and
  changed-file type-aware ESLint passed.
- API inventory, audience, and TypeScript snippet checks passed with 107 Auth
  and 248 Server root exports, including documented `GatewayAdmission` and
  `BrowserAdmission`.
