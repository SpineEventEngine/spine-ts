# T-0206 — Managed complete-replica process lifecycle

**Status:** Framed; implementation pending

## Classification and baseline

- Risk: **high**. This task adds public managed startup plus concurrent child
  lifecycle, process IPC, restart/backoff, readiness, and cleanup behavior.
- Baseline: integrated `origin/main` commit
  `ec9a382b9cc283d435e9e5fa2ba2e1beeae22d56`.
- Branch/worktree: `codex/t0206-managed-replicas` at
  `/tmp/spine-ts-t0206`.
- Owner: existing `implementer` role, explicitly configured
  `gpt-5.6-terra` / `medium`; subagent spawning is prohibited. Runtime
  self-telemetry is recorded only if the execution surface exposes it.

## Objective and ownership

Add the managed Node entrypoint and private control machinery that starts one
coordinator parent plus exactly `processCount` complete application replicas.
This slice owns process lifecycle only. It does not proxy a Command, Query, or
Subscription yet.

The implementation belongs in `@spine-event-engine/server`: that package owns
`Server` assembly and already depends on `deployment`; putting it in
`deployment` would create a package cycle. The smallest private server seam may
expose an immutable assembly/replica report, but public `Server.run()` remains
independent and browser-safe.

Owned paths:

- new managed-application and private child-control modules under
  `packages/server/src/server/**`;
- the narrow internal `Server`/`BoundedContext` assembly-report seam needed to
  derive the replica manifest;
- the public server entrypoint/export, TSDoc, API inventory, and directly
  affected reference documentation;
- real child fixtures and focused server lifecycle tests;
- this task's records.

Do not edit Gateway/Auth membership, Coordinator HTTP/2 forwarding,
Subscription fan-out, Delivery lease semantics, IntegrationBroker behavior,
provider packages, examples, generic signal routing, or ZeroMQ removal.

## Human-imposed requirements

| ID    | Binding requirement                                                                                                                         | Behavioral proof                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| H-005 | Every managed child is a complete replica of the application's Bounded Contexts, schema, and Delivery topology.                             | Deterministic private manifest equality and real-process mismatch rejection. |
| H-009 | `processCount` is an explicit deployer setting; no CPU inspection or inferred default exists.                                               | Missing/invalid value matrix and forbidden-import scan.                      |
| H-010 | Process count and Delivery shard count remain independent concepts.                                                                         | No numeric coupling in validation or manifest comparison.                    |
| H-011 | Children will observe Delivery directly; the parent IPC carries no Delivery notification or application signal.                             | Control-frame allowlist/dependency scan and synchronization-hook proof.      |
| H-017 | Direct single-process `Server.run()` and browser use remain independent of managed Node machinery.                                          | Existing lifecycle/browser tests and import-boundary scan.                   |
| H-022 | Unexpected child exit preserves reduced service and starts a bounded replacement; it never fails the whole node solely for one child crash. | Real-process crash/replacement and fake-clock policy tests.                  |

## Frozen lifecycle contract

- The same ESM entry module runs in parent and child. Functions and application
  objects are never serialized. A private environment/control marker tells the
  child to call the locally supplied `createServer()` once.
- `processCount` is required and must be a positive safe integer. Managed mode
  never reads CPU count. `processCount: 1` still means one parent and one
  separate application child.
- Stable logical slots receive immutable per-incarnation identities.
- States are `STARTING -> SYNCHRONIZING -> READY -> DRAINING -> CLOSED`.
- A child is not READY until its manifest equals the first accepted cohort
  manifest and all registered synchronization gates resolve. T-0208 and T-0209
  later bind subscription and Delivery readiness to those gates; T-0206 proves
  the gate without owning those subsystems.
- Initial node readiness requires every configured slot to synchronize at
  least once. Thereafter the node stays ready while at least one child is
  READY. With zero READY children it remains alive and continues replacements.
- Unexpected exits remove the exact incarnation immediately. Surviving READY
  children remain available. An in-flight operation is failed, never replayed;
  the actual unary call proof belongs to T-0207.
- Restart defaults are 250 ms initial delay, 30 seconds maximum delay, 60
  seconds continuously READY before reset, and `min(4, processCount)`
  concurrent starts. Supplied values are positive finite safe integers;
  maximum delay is not below initial delay; concurrency does not exceed
  `processCount`.
- Backoff doubles per pre-reset failure, caps at the maximum, continues
  indefinitely, and creates at most one in-flight replacement per slot.
- Expected DRAINING/CLOSED exits never restart. Close cancels and awaits every
  timer, pending start, child, IPC listener, and signal handler. Failed cleanup
  remains observable and retryable where the existing server lifecycle does.
- IPC accepts only bounded lifecycle/control facts: hello, slot/incarnation,
  private endpoint, manifest digest, readiness state, drain, close, and terminal
  failure. No Command, Event, Query, SubscriptionUpdate, ExternalMessage,
  InboxMessage, application payload, callback, or public Proto is introduced.
- Logs expose only safe slot, incarnation, attempt, delay, operation, and reason
  codes—never raw child errors or application payloads.

## Failing-before acceptance

Retain RED evidence before product changes for plan cases 3–6 and 33–41:

1. Missing, zero, fractional, negative, non-finite, and unsafe
   `processCount` values reject without CPU inspection.
2. `processCount: 1` starts a coordinator parent and one distinct complete
   child PID.
3. `processCount: 4` starts four distinct child PIDs owned by one parent
   lifecycle.
4. One child with a different context/schema/Delivery manifest prevents
   initial readiness and cleans the cohort.
5. Unexpected READY-child exit removes only that incarnation; survivors
   continue and one replacement for the same slot receives a fresh identity.
6. Fake-clock restart delays double, cap, never spin, and reset after the
   configured healthy READY interval.
7. Simultaneous failures never exceed the concurrent-start limit and leave no
   unbounded timers, listeners, records, or children.
8. A replacement remains ineligible until manifest equality and every current
   synchronization gate complete.
9. After first cohort readiness, zero READY children makes the handle unready
   while replacements continue; readiness returns with one synchronized child.
10. A child exit rejects an admitted-operation lease without retry. T-0207 will
    prove this through real CommandService HTTP/2.
11. DRAINING/CLOSED exits do not restart; coordinator close cancels and awaits
    pending delays and starts without orphan processes or handles.

## Verification and review

- Focused unit tests use injectable clocks/spawners only through private seams;
  process topology and cleanup have real `fork()` acceptance.
- Run generated/affected package builds, tooling typecheck, ESLint, TSDoc/API
  docs, cleanup, copyright, formatting, diff checks, and exact changed-source
  coverage of at least 90% lines and branches.
- Run `verify:release` after review because this changes shared public runtime,
  child processes, lifecycle, and test infrastructure.
- Required review concerns: style/maintainability, TypeScript/API docs, and
  performance/reliability. Documentation review applies to the public managed
  startup guide. Final security review remains reserved for full program
  convergence unless the implementation adds a public wire or trust boundary
  beyond this frozen private IPC seam.
- Commit and push every green checkpoint to
  `origin/codex/t0206-managed-replicas`.

## Skill and profile record

- The orchestrator selected and fully read `executing-plans`,
  `subagent-driven-development`, `using-git-worktrees`,
  `test-driven-development`, and `systematic-debugging` earlier in this
  execution chain.
- The implementation owner must read `test-driven-development` completely
  before product changes. It must use `systematic-debugging` if a RED fails for
  an unexpected reason.
- A read-only `explorer` mapped the current lifecycle with explicit
  `gpt-5.6-luna` / `low`. Runtime telemetry was unavailable; no files changed.
