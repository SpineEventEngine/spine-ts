# T-0206 work log

## 2026-08-18 — Final release verification

- The fork-pool isolation correction was pushed at `93fcd4942`. It changes
  tests only: simulated process signals and IPC events invoke only the managed
  lifecycle listeners, and simulated connected processes stub
  `process.disconnect()`. Real forked-parent signal acceptance remains intact.
- The formerly failing focused fork-pool matrix passed 55/55 tests. Coverage
  for `managed-server-application.ts` was 95.53% statements, 90.00% branches,
  97.22% functions, and 99.14% lines.
- `pnpm verify:release` completed successfully on the pushed checkpoint. The
  main suite passed 4,309 tests with 19 skipped across 266 passing and four
  skipped files. Repository coverage was 94.08% statements, 90.30% branches,
  94.11% functions, and 95.24% lines.
- The separate real cross-process IntegrationBroker acceptance passed 1/1.
  Node, exact Proto intake, generated builds, tooling typecheck, ESLint,
  cleanup, TSDoc, copyright, formatting, documentation/API inventories, Buf,
  generated-source cleanliness, logging containment, and release-readiness
  gates all passed.
- No Vitest worker exit recurred. The task is complete and ready for isolated
  integration with the current `origin/main`.

## 2026-08-18 — Fork-pool coverage correction

- RED: the default Vitest fork-pool command for the managed lifecycle file
  reproducibly reported `Worker exited unexpectedly` and produced zero V8
  coverage. The focused `SIGINT` case alone reproduced the failure, while an
  adjacent asynchronous-error case passed. The private message/disconnect
  retry cases also reproduced an IPC `write EPIPE`.
- Root cause: unit tests broadcast framework process signals/messages into the
  Vitest worker and successfully closed simulated children while leaving the
  worker's real `process.disconnect()` active. Those actions terminate the
  runner IPC before V8 can flush coverage. The real forked parent
  SIGTERM/SIGINT acceptance remains unchanged.
- GREEN: tests capture pre-existing listeners and directly invoke only the
  managed listener; direct `once("disconnect")` invocation removes its
  registered listener explicitly. Every simulated connected parent or child
  now stubs and restores `process.disconnect`. No managed lifecycle product
  code changed.
- GREEN evidence: the formerly failing single SIGINT fork-pool selection now
  passes with nonzero coverage; lifecycle/logging under default forks passes
  45/45; paired root-export/lifecycle fork-pool run passes 49/49. Scoped
  coverage is 95.53% statements, 90.00% branches, 97.22% functions, and
  99.14% lines. Tooling typecheck, scoped lint, formatting, and diff checks
  passed. This test-runner isolation correction does not reopen reviews.

## 2026-08-18 — Release-test inventory correction

- The converged release ran 264 files and 4,269 tests successfully except for
  the exact root-export inventory: `ManagedServerApplication` is an approved
  value export but was absent from the `Object.keys()` expectation. Added that
  value only; type-only managed exports do not appear in the runtime list.
- Vitest also reported one worker exited unexpectedly without a test stack.
  Static lifecycle inspection and fresh focused index/managed-lifecycle runs
  found no leaked managed child, helper, or Vitest process; the post-run audit
  is empty. This is recorded as a non-reproduced runner artifact, with no
  speculative lifecycle change.
- GREEN evidence: paired root-export and managed lifecycle suites, tooling
  typecheck, focused lint, formatting, and diff checks passed. This test
  inventory correction does not reopen completed reviews.

## 2026-08-18 — Release-preflight fixture correction

- The converged `pnpm verify:release` reached repository ESLint before tests
  and failed only because three managed-process fixture modules used implicit
  Node globals (`process`, `console`, and `setTimeout`).
- Fixtures now import those Node APIs explicitly. The gated child also replaces
  its silently ignored obsolete `host`, `port`, and `synchronizationGates`
  fields with the actual child-only `synchronize()` callback, so its readiness
  acceptance now observes the intended 250-millisecond synchronization gate.
  Parent READY reporting and runtime product behavior remain unchanged.
- GREEN evidence: exact-fixture ESLint, tooling typecheck, focused managed
  lifecycle Vitest (39/39), including the exact synchronization acceptance,
  formatting, and diff checks passed. This
  fixture-only release-preflight correction does not reopen completed reviews.

## 2026-08-18 — TSDoc-preflight correction

- `pnpm lint:tsdoc` found only authored documentation structure gaps on the
  managed application options, handle, coordinator, test dependencies, and
  internal topology handoffs.
- Rewrote those blocks in the canonical multi-line layout with concrete
  summaries and exact parameter/return descriptions. Prettier-ignore markers
  preserve the required blank line at interface and nested-object boundaries.
  No runtime behavior or public type shape changed.
- GREEN evidence: fresh TSDoc lint, generated API documentation, API contract
  check, tooling typecheck, formatting, and diff checks passed. This docs-only
  correction does not reopen completed reviews.

## 2026-08-18 — Cleanup-preflight correction

- `pnpm lint:cleanup` found only two deterministic policy gaps: the injected
  clock callback was named `action` rather than `onTimeout`, and the private
  canonical READY loopback validator lacked its exact standalone-function
  necessity disposition.
- Renamed both callback declarations consistently and recorded the validator in
  the canonical server cleanup ledger. This changes neither lifecycle behavior
  nor public API.
- GREEN evidence: fresh cleanup lint, tooling typecheck, focused
  lifecycle/logging Vitest (45/45), formatting, and diff checks passed. This
  naming/ledger correction does not reopen completed reviews.

## 2026-08-18 — Tooling-preflight correction

- Mandatory cheap preflight `pnpm typecheck:tooling` initially failed only in
  `managed-server-application.test.ts`: strict test compilation found unchecked
  replica/PID array access, incomplete `RunningServer` fakes, and the special
  Node process `message` event typing.
- The correction adds test-only narrowing helpers, one complete loopback
  `RunningServer` fixture, and an `EventEmitter`-level message emitter. It does
  not change managed lifecycle behavior or production code.
- The focused suite also proves coordinator close drains a retired failed
  child, retaining the changed-source branch threshold after the strict-fixture
  cleanup.
- GREEN evidence: fresh `pnpm typecheck:tooling`, focused lifecycle/logging
  Vitest (45/45), changed-source coverage (95.53% statements, 90.00% branches,
  97.22% functions, and 99.14% lines), scoped ESLint, formatting, and diff
  checks passed. This deterministic test-only correction does not reopen
  completed reviews.

## 2026-08-18 — Final focused re-review correction

- The final focused re-review found two P1s: private child `message` and
  `disconnect` close triggers detached rejected close promises, and failed
  asynchronous-error termination was removed from coordinator ownership before
  a later close could retry it.
- RED: the old event handlers used `void close()` and the old termination set
  deleted a rejected task despite a live retired child.
- GREEN: event-triggered child close is explicitly contained and logged with
  safe lifecycle facts; explicit `handle.close()` retains its rejecting and
  retryable contract. Both `message` and `disconnect` failure paths prove no
  `unhandledRejection` and later explicit success.
- GREEN: retired replicas stay coordinator-owned until an independently
  observed `exit` or a successful bounded termination. Each retired replica
  has one private in-flight termination promise; a failed attempt remains
  retryable by later coordinator close. The fake-clock acceptance proves an
  async error, failed TERM/KILL, rejected close, later observed exit, and
  successful retry.
- GREEN evidence: focused lifecycle/logging tests passed 44/44 with 95.59%
  statements, 90.96% branches, 97.43% functions, and 99.21% lines across the
  changed source. Typecheck, scoped lint, logging-containment, copyright,
  formatting, and diff checks are run before push.

## 2026-08-18 — Final re-review correction

- The re-review found two remaining lifecycle P1s: rejected parent/child close
  promises were cached permanently, and a non-exiting child after `SIGKILL`
  left a parent close awaiting forever. The assignment remains the existing
  `implementer` role with explicit `gpt-5.6-terra` / `medium`; no subagents
  were used and runtime model telemetry is unavailable.
- RED: the existing tests could not retry a rejected close and the fake-clock
  close path had no final settlement after `SIGKILL`.
- GREEN: parent and child close cache only an in-flight or successful attempt;
  a rejection clears the cache for an explicit retry while concurrent callers
  continue sharing the same attempt. Successful cleanup remains idempotent.
  The child removes IPC listeners/disconnects only after successful local
  close, preserving retryability.
- GREEN: termination uses the injected private clock for grace, `SIGTERM`,
  `SIGKILL`, and one final bounded wait. A non-exiting child rejects with the
  deterministic `Managed child did not exit after SIGKILL.` outcome rather
  than retaining an unbounded close. An asynchronous child error retires its
  membership and starts a bounded private termination while replacement stays
  independent; terminal failure is contained as a safe lifecycle warning.
- GREEN evidence: `pnpm exec vitest run
packages/server/test/server/managed-server-application.test.ts
packages/server/test/server/server-log.test.ts --coverage --pool=threads`
  passed 41/41 with 94.98% statements, 90.28% branches, 94.52% functions, and
  98.34% lines across the changed lifecycle/logging source. Typecheck, scoped
  ESLint, copyright, and logging-containment checks also passed. No public
  option, delivery strategy rule, application IPC, retry, or manifest was
  added.

## 2026-08-18 — Review-correction checkpoint A

- Returned to the existing bounded implementation role after the first review
  wave. The configured profile is `gpt-5.6-terra` / `medium`; this surface does
  not reveal runtime model telemetry. No subagents were used.
- RED: the prior public-handle assertions failed after topology facts were
  removed from the handle; the revised tests now use the explicit internal
  handoff accessor. The focused lifecycle suite also exposed missing endpoint
  validation and parent signal ownership before the correction.
- GREEN: public options no longer contain unused Coordinator `host`/`port`;
  child synchronization is the lazy child-only `synchronize()` callback; the
  public handle contains only `ready` and `close()`. Ready PIDs, endpoints,
  slots, and incarnations remain available only through the internal handoff
  for T-0207 and lifecycle tests.
- GREEN: parent `SIGTERM`/`SIGINT` follows the shared close path and a real
  fork proof verifies its child is gone afterwards. Child IPC disconnect starts
  local close. `error` and later `exit` are fenced as one failed incarnation.
  READY accepts only bounded canonical `http://127.0.0.1:<port>` loopback
  origins. Child stdio is inherited rather than unread `silent` pipes.
- Evidence: `pnpm exec tsc -p packages/server/tsconfig.json`; `pnpm docs:api:check`
  (259 server exports); and `pnpm exec vitest run
packages/server/test/server/managed-server-application.test.ts --pool=threads`
  (28/28) passed. Parent SIGINT/SIGTERM cleanup, child IPC disconnect,
  bounded TERM/KILL close, inherited child stdio, and endpoint/terminal fencing
  are covered by this same focused suite. Parent lifecycle warnings use the
  existing contained server logging helper with only bounded allowlisted
  slot/incarnation/attempt/delay/reason facts; it never resolves a parent
  `ServerEnvironment` merely to obtain a child application logger. Focused
  changed-source coverage is 93.75% statements, 90.90% branches, 92.30%
  functions, and 96.42% lines across the changed managed lifecycle and logging
  source. Full pre-review validation remains pending.

## 2026-08-18 — Framing and code map

- Fresh baseline is integrated `origin/main` at `ec9a382b9`; the protected
  primary checkout was not used for implementation.
- Current `Server.start()` is caller-managed; `Server.run()` adds process
  signal ownership through the private `ProcessServerCoordinator`.
  `RunningServer` exposes only host, port, URL, and close.
- No managed multi-process application implementation exists. Existing real
  process fixtures in server and Delivery provide bounded readiness,
  termination, and orphan-cleanup patterns but are not product supervisors.
- The implementation belongs in `server`, not `deployment`: `server` already
  depends on `deployment`, so the inverse import would create a cycle.
- The existing `RetryableCloseGroup`, `RunningHttp2Server` close ordering, and
  process signal coordinator are reusable lifecycle patterns. Delivery's
  reconnect backoff is evidence for bounded timers but is not reused as child
  restart policy because the ownership and healthy-reset semantics differ.
- At framing, an immutable internal assembly report was considered for runtime
  manifest derivation. The later human correction below rejects that
  precautionary mechanism.
- No conceptual blocker was found. Product implementation remains pending
  until this framing checkpoint is pushed.

## 2026-08-18 — Checkpoint A: validation RED/GREEN

- Implementation owner: existing `implementer` role, configured explicitly as
  `gpt-5.6-terra` / `medium` by the orchestrator. This execution surface does
  not expose runtime model telemetry, so the immutable dispatch profile is the
  available record. No subagents were used.
- Selected governing skill: `test-driven-development`, fully read before
  product changes. `systematic-debugging` was fully read after the first RED
  was blocked unexpectedly before test collection.
- JVM guardrail inspected: `spine-jvm-docs/spine-validation-storage-observability-and-support.md`,
  including its `ServerEnvironment` source mapping and process-wide semantic.
  This slice retains that local complete-server assembly model and adds no JVM-
  divergent application routing concept.
- The initial focused Vitest invocation failed before collection because fresh
  workspace package exports pointed to absent generated/build outputs. Root
  cause evidence: `packages/core/dist` was absent and direct `tsc -b` showed
  absent generated Proto imports. `pnpm proto:generate` plus
  `pnpm typecheck:build:generated` restored the normal test resolution path;
  this was a worktree prerequisite, not a product change.
- RED evidence retained: `pnpm exec vitest run
packages/server/test/server/managed-server-application.test.ts` then collected
  six tests and failed each with `ManagedServerApplication` undefined.
- GREEN evidence: the same command passed 6/6 after adding the smallest public
  validation boundary. It rejects missing, zero, negative, fractional,
  non-finite, and unsafe `processCount` values without CPU inspection.
- Checkpoint A remains in progress: topology, IPC, manifests, lifecycle policy,
  real-process fixtures, and public documentation are still pending.

## 2026-08-18 — Checkpoint B: initial fork topology

- Restored exactly the ten generated `.spine-proto-generation.json` and
  `spine-proto-manifest.json` generation-ID byproducts to `HEAD` after local
  prerequisite generation. The restoration was mechanical and touched no other
  path.
- RED: the real-process one-child fixture failed with `Managed server process
lifecycle has not started.` before parent/child implementation.
- GREEN: after `pnpm typecheck:build:generated`, the focused lifecycle test
  passed 7/7, including one parent-managed distinct child PID, private ready
  IPC, and parent-requested child close.
- Still pending: N-child topology, deterministic manifest, synchronization
  gates, replacement/backoff, and public documentation.

## 2026-08-18 — Delivery strategy manifest correction

- A bounded architecture audit confirmed that arbitrary `DeliveryStrategy`
  behavior has no exact runtime configuration identity: the public seam is
  only `shardCount` plus `shardFor()`, and finite sampling or function-source
  comparison cannot prove behavioral equality.
- The human clarified that Delivery strategy selection is the framework user's
  responsibility and every deployed replica must use the same application
  code. The framework therefore must not identify, serialize, compare, sample,
  or restrict the strategy in managed mode.
- This intermediate disposition removed only strategy identity while retaining
  a narrower replica manifest. The later human correction below supersedes it
  and removes runtime application attestation entirely.
- This initially appeared to resolve the architecture blocker by narrowing the
  manifest, but the following human correction removes the unrequested
  manifest mechanism entirely.

## 2026-08-18 — Remove invented runtime attestation

- The human rejected the Delivery-strategy identity and the broader runtime
  application-manifest mechanism as unrequested precautionary architecture.
- The managed launcher already runs the same configured application entry
  module in every child. Framework users own complete application assembly,
  Delivery strategy, code, and deployment configuration across nodes.
- Removed runtime manifests, schema/handler digests, build attestations,
  strategy identities, sampling, and custom-strategy restrictions from the
  accepted plan and T-0206 contract. No product implementation of those ideas
  was committed.
- T-0206 now implements only necessary deployment behavior: explicit process
  count, real child assembly/listeners, synchronization readiness gates,
  bounded replacement, graceful drain, and deterministic cleanup.

## 2026-08-18 — Ownership transfer and managed lifecycle checkpoints

- Ownership transferred to the current existing `implementer` role with the
  explicit configured profile `gpt-5.6-terra` / `medium`; this surface does not
  expose runtime model telemetry and no subagents were used.
- The predecessor's uncommitted endpoint/gate prototype was restored to its
  pushed `HEAD` before implementation. A new real-child endpoint acceptance
  test then failed against that head (`childEndpoints` was `undefined`), and
  passed after the smallest readiness message implementation. This is the
  retained RED/GREEN evidence for the transferred hunk.
- `979efe2e7` reports the actual child listener endpoint only after its local
  server and synchronization gates settle. Focused real-child suite: 9/9.
- `8bd24ca2c` adds stable parent slots, private per-incarnation UUIDs,
  replacement after unexpected exit, bounded restart settings, and close-time
  timer cancellation. The real-child suite passed 11/11 after a generated
  build refreshed the fixture's `dist` import. The initially hung run was
  diagnosed as a source-vs-built-child IPC-shape mismatch; only its known stale
  test parents and child fixtures were terminated, and a subsequent single run
  left no process handles.
- No application manifest, schema/handler digest, Delivery-strategy identity,
  sampling, build attestation, new public Proto, signal IPC, or application
  payload transport was introduced.

## 2026-08-18 — Deterministic lifecycle convergence

- Added an internal-only clock/spawner seam to the parent-only coordinator. It
  replaces direct Node timers and `fork()` only for deterministic module tests;
  production retains Node timers and `fork()`, and no root export or deployment
  setting was added.
- RED/GREEN proofs now cover capped exponential retry (including healthy READY
  reset), malformed and stale READY facts, unexpected pre-READY exit,
  synchronous child-start failure, zero-ready recovery, bounded concurrent
  starts, shared close completion, and close-time removal of PIDs/endpoints.
- The supervisor catches only synchronous private spawn failure and schedules
  the same bounded replacement path. It carries no error payload over IPC and
  adds no retry for application requests.
- Focused coverage is 95.58% executable lines, 93.58% statements, and 90.21%
  branches for `managed-server-application.ts` (23 tests). This satisfies the
  task's changed-source threshold before review.

## 2026-08-18 — Complete specialist review wave

- The four required concern-specific reviews completed against pushed
  checkpoint `39806c10e`. Focused behavior remained green at 23/23, but review
  found lifecycle and public-contract gaps that prevent integration.
- The highest-severity proof sent `SIGTERM` to a real managed parent and found
  its application child still alive. Parent signal ownership and IPC-disconnect
  cleanup are therefore P0 correction requirements.
- Other accepted findings cover async fork errors, disconnected close,
  unread child output pipes, bounded loopback endpoints, lazy child-only
  synchronization, removal of no-op `host`/`port`, internal-only topology,
  API inventory, safe lifecycle logs, and readiness/strategy documentation.
- `REVIEW.md` contains the single consolidated correction batch. No product
  correction is accepted until all four affected concerns re-review it.
