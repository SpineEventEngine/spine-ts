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

## Final TypeDoc correction evidence

- Generated API reference exposes `UnaryGatewayCollaborators` and
  `BrowserServerCollaborators`, with their complete common option fields, and
  their intentional root inventories contain 108 Auth and 249 Server exports.
- Generated build/tooling typechecks, TypeScript snippets, audience checks,
  TSDoc, changed-file type-aware lint, formatting, and diff hygiene passed.

## Final constituent visibility evidence

- Generated API reference exposes every public option constituent, including
  `SubscriptionGatewayCollaborators` and `BrowserBackend`; their inventory
  entries are intentional and documented.

## Public actor-admission evidence

- RED: native actorless Subscribe reached `BoardContextResolver` and rejected
  with `Error: Public demo actor is required.` instead of `PermissionDenied`.
- GREEN: adapter-level actorless Read, Subscribe, Activate, and Cancel reject
  with code 7; no unary forward or subscription binding creation occurs. Missing
  and whitespace-only actors are denied for every public operation.

## Final lifecycle wording evidence

- Auth reference now scopes the shared 30-second pending
  Subscribe-to-Activate cleanup to public definitions and documents
  session-derived expiry for authenticated durable definitions.

## Final cheap preflight

- After registering the existing public pending-cleanup no-log boundary, the
  entire cheap preflight was restarted.
- Changed-file formatting, shell syntax, branch/local diff hygiene, generated
  build, tooling typecheck, changed-file ESLint, cleanup enforcement, TSDoc,
  logging containment, API inventory, audience, and generated snippets pass.
- Focused lifecycle regression wave: 8 files / 350 tests pass.
- Expanded focused coverage wave: 14 files / 447 tests pass.
- Whole selected-module coverage is diluted by unchanged legacy branches and is
  not the acceptance metric. Exact baseline-to-head changed executable coverage
  from the fresh LCOV is 144/150 lines (96.00%) and 146/161 branches (90.68%).

## Full release verification

- The first full invocation stopped before tests because accidentally committed
  private `.planning` files violated reader-documentation policy. Their local
  working copies were hashed and preserved outside Git; the tracked artifacts
  were removed in `65b398c9` without changing product behavior.
- The entire cheap preflight was restarted on clean, pushed SHA `65b398c9`; all
  gates and the exact changed-code coverage above passed again.
- `pnpm verify:release` then completed with exit code 0: 270 test files passed,
  4 skipped; 4,344 tests passed, 19 skipped. Global coverage is 93.47%
  statements, 90.07% branches, 93.02% functions, and 94.61% lines.
- The same terminal run passed Node/Proto/frozen-descriptor checks, generated
  build, tooling typecheck, repository ESLint, cleanup, TSDoc, copyright,
  formatting, TypeDoc/API, audience, snippets, Buf, generated cleanliness,
  logging containment, and release readiness.

## Integration

- `origin/main` remained at the reviewed baseline with no divergent commits, so
  integration was a conflict-free fast-forward of the verified branch.
- The dirty, stale local `main` worktree was not modified. Remote `main` and the
  feature branch were advanced directly from the isolated verified worktree.
- Private planning notes were restored locally after verification as untracked
  files with their pre-removal SHA-256 hashes unchanged; they are absent from
  the product branch.

## Cheap-preflight containment evidence

- `pnpm check:logging-containment` initially failed only because
  `auth.public_pending_subscription_cleanup` was absent from the manifest.
  It is now registered as a no-log cleanup boundary with the existing focused
  Auth subscription test owner.
