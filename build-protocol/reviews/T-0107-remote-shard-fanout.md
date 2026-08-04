# T-0107 Review Record

Status: Accepted

## Review Endpoint

- Baseline: `origin/main@ce1ef99e`.
- Endpoint: `7720979e`.
- The endpoint is clean and pushed.
- Mechanical preflight: accepted. The exact focused `verify:task` profile
  passed after the deterministic integration-test lint correction.

## Assignments

- Style/maintainability: existing `style_maintainability_reviewer`, explicit
  `gpt-5.6-terra` / `high`. Reviews lifecycle boundaries and simplicity.
- Documentation: existing immutable `documentation_reviewer`,
  `gpt-5.6-luna` / `medium`. Reviews changed README/reference claims.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, explicit
  `gpt-5.6-terra` / `high`. Reviews the additive delivery-source contract and
  its declarations/TSDoc.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicit `gpt-5.6-terra` / `high`. Reviews fan-out, leases, reconnect,
  overflow, fencing, resource bounds, and shutdown.
- Security: N/A. The task adds no new externally reachable service, credential,
  authorization, deserialization, or deployment trust boundary; it connects
  an already configured delivery-server client to the existing supervisor.

Every dispatch must name its expected model and reasoning explicitly. The
Desktop surface exposes immutable reviewer profiles but no child runtime
self-introspection; absent visible mismatch, the configured role/profile and
explicit dispatch fields are the actual-metadata evidence.

## Results

The complete first specialist wave returned the following consolidated
findings:

1. P1 style/reliability: supervisor watch restart proceeds after a failed
   recovery snapshot because recovery swallows the error. Reopening must be
   gated by successful snapshot recovery and covered by regression evidence.
2. P1 reliability: client-internal observation reconnect can resume live
   updates without exposing failure to the supervisor, bypassing its snapshot
   barrier.
3. P1 reliability: an expired/released remote shard owner is not fenced from
   committing an already running Entity callback after another node acquires
   the shard. The release service also needs to match the current worker/session
   rather than releasing an unrelated current owner.
4. P1 style/reliability: the real-gRPC scenario builds raw clients and
   supervisors instead of exercising `RemoteDelivery` through two application
   environment assembly paths, and it lacks required fault/recovery coverage.
5. P2 style: real-gRPC teardown does not close supervisors on every failure
   path.
6. P2 process: the task brief lacks its mandatory Human-Imposed Requirements
   Ledger.
7. P2 documentation: README/reference omit the concrete multi-node workflow,
   one-owner-per-shard semantics, and lack of cross-shard ordering.
8. P2 API: validate an optional dynamically supplied delivery `source` before
   passing it to the typed supervisor boundary.
9. P2 API/documentation: server reference omits the additive optional
   `ServerEnvironmentDelivery.source` contract and its fallback/lifecycle
   behavior.

The first documentation dispatch supplied an incompatible Terra override and
was rejected before acceptance. The replacement used the immutable
`documentation_reviewer` Luna/medium profile; runtime self-introspection was
unavailable and no visible mismatch occurred. The other reviewers confirmed
their explicit Terra/high assignments with the same self-introspection
limitation.

The remote ownership-fence finding is a demonstrated high-risk architectural
ambiguity. Before correction dispatch, one existing `requirements_splitter`
pass will determine the smallest compatible fence using explicit
`gpt-5.6-sol` / `high`. No implementation writer is active during this
read-only reassessment.

## Architecture Disposition

The bounded Sol/high reassessment completed without a human blocker. Runtime
self-introspection was unavailable; the immutable splitter profile and explicit
dispatch fields are accepted, with no visible mismatch.

The frozen wire already carries `WorkerId { nodeId, value }` on pickup outcome,
session state, and release. Corrections will:

- assign a unique opaque `WorkerId.value` per acquisition while retaining the
  stable node ID;
- refresh only the same live worker during revalidation and make release match
  the complete current worker;
- treat a newly returned pickup during old-session revalidation as ownership
  loss and release that accidental acquisition;
- establish one internal delivery commit-fence scope and revalidate immediately
  before the existing synchronous Entity transaction commit, with no
  intervening asynchronous boundary;
- expose the first stream break for supervisor-owned observations, require a
  successful complete snapshot before reopening, and retain public client
  reconnect behavior outside the supervisor source; and
- replace the raw supervisor fixture with environment/`RemoteDelivery`
  assembly and failure-safe teardown, adding the required real-gRPC fault and
  recovery evidence.

No Protobuf, generated-code, or new public method is required. The complete
review findings plus this blueprint return as one correction batch to the
existing Terra/medium implementation owner.

## Correction Re-review Endpoint

- Baseline: `origin/main@ce1ef99e`.
- Corrected endpoint: `897deab8`, clean and pushed.
- The focused real-gRPC recovery scenarios passed three consecutive runs; the
  focused recovery suite passed 108/108. Delivery-client/server typechecks,
  focused ESLint, Prettier, and diff checks passed.
- The final task preflight passed Proto integrity, the workspace build, and
  strict TypeScript checking after the deterministic test-transport typing
  correction in `897deab8`.
- Re-review assignments retain the existing concern-specific roles:
  style/maintainability, TypeScript/API, and performance/reliability use
  explicit `gpt-5.6-terra` / `high`; documentation uses the immutable
  `documentation_reviewer` at `gpt-5.6-luna` / `medium`.
- Runtime self-introspection remains unavailable. The explicit dispatch fields
  and immutable configured profiles are the actual-metadata evidence unless a
  visible mismatch occurs.

## Correction Re-review Results

The complete affected re-review wave requested one consolidated correction
batch:

1. P1 TypeScript/API: private revalidation request/response headers make the
   new commit fence depend on an undocumented wire acknowledgement. A server
   implementing the frozen Protobuf contract but not those headers prevents
   remote commits. Revalidation must use a compatible, explicitly justified
   contract rather than silently extending the wire.
2. P1 reliability: aborting a delivery run lets supervisor closure finish
   before a blocked drain unwinds, and its eventual remote release inherits the
   aborted operation signal. The release can therefore be skipped until lease
   expiry. Shutdown needs bounded, uncancelled ownership cleanup plus real
   remote failover evidence.
3. P2 reliability: the real overflow case overflows a separately created
   source while environment supervisors consume different sources. Install the
   constrained source in the environment path and prove supervisor snapshot,
   watch reopening, and retained-row convergence.
4. P2 style: child fixture teardown awaits detachment before environment close,
   and parent child-process shutdown is unbounded. Cleanup must attempt every
   owner in bounded, failure-safe order.
5. P2 style: revalidation ownership is duplicated between
   `RemoteSessionValues` and `RemoteWorkRegistry.#sessions`; tests exercise a
   private registry seam rather than the live commit-fence path. Consolidate
   the state owner and direct evidence at production synchronization.
6. P2 documentation: README/reference material must state that the winning
   owner repeats finite drains until no deliverable Inbox work remains,
   including rows arriving during the active drain, before releasing.

Confirmed resolved: snapshot-gated watch reopening, one-attempt supervisor
observation, real `ServerEnvironment` plus `RemoteDelivery` assembly, dynamic
source validation, public source declarations/TSDoc/reference, bounded queues,
owner-matched release, unique ownership generation, real restart recovery,
two-node fan-out, mid-drain wake-up, no cross-shard ordering claim, and the
human requirements ledger.

The API P1 exposes a high-risk frozen-wire compatibility ambiguity. Before
returning this one batch to implementation, an existing
`requirements_splitter` is assigned with explicit `gpt-5.6-sol` / `high` to
select the smallest compatible design. The other corrections require no human
decision or new review lane.

## Frozen-Wire Correction Disposition

The existing `requirements_splitter`, explicit `gpt-5.6-sol` / `high`, found
no Proto/public-contract change and no human decision necessary. Runtime
self-introspection was unavailable; the immutable role/profile and explicit
dispatch are accepted with no visible mismatch.

The implementation owner must:

- remove required private pickup/revalidation metadata from the client path;
- preserve the exact unique acquisition worker and original `whenPicked`, but
  probe ownership with an ordinary frozen `PickShard` using a fresh challenger
  worker;
- authorize the immediate synchronous commit only when the result is
  `already_picked_up` naming the original worker and generation; treat a new
  challenger pickup, another owner/generation, malformed reply, or unknown
  outcome as ownership loss and fail closed;
- release an accidentally acquired challenger through bounded cleanup that is
  independent of the aborted delivery-operation signal;
- consolidate remote session, shard index, quarantine, release, invalidate,
  reconcile, and synchronize state in one package-private per-client owner used
  by both `RemoteWorkRegistry` and `RemoteInboxWork`; delete the test-only
  alternate revalidation seam;
- stop requiring the private conditional-pickup acknowledgement; ordinary
  `PickShard`, finite scan, and release are the compatible bounded fallback;
- retain exact-worker release and non-authoritative Admin `PICKED` semantics;
  and
- test scripted header-ignorant/JVM-compatible outcomes plus the live
  environment-to-repository commit fence.

The frozen wire cannot make ownership validation and an Entity-storage commit
one distributed transaction. This task retains the accepted immediate
pre-commit probe with no intervening asynchronous boundary and must not claim a
stronger linearizable revocation guarantee. A storage-transaction fencing token
would be a separate serialized/storage design requiring a future human choice.

## Final Correction Endpoint

- Corrected implementation endpoint: `d55e52cc`, clean and pushed.
- Focused correction evidence passes 65/65 with no skipped test; package output
  was rebuilt before child-process fixtures, and delivery-client/server
  typechecks, ESLint, Prettier, and diff checks pass.
- The final affected re-review uses the existing concern roles only:
  style/maintainability, TypeScript/API, and performance/reliability use
  explicit `gpt-5.6-terra` / `high`; documentation uses its immutable
  `gpt-5.6-luna` / `medium` profile. Runtime self-introspection is unavailable,
  so explicit dispatch plus immutable role configuration are the metadata
  evidence unless a visible mismatch occurs.
- Re-review is limited to the six recorded findings and corrections: frozen
  wire compatibility, canonical session ownership, bounded uncancelled release
  and failure-safe teardown, environment-path overflow convergence, enabled
  builder-path evidence, and drain-until-empty/linearizability documentation.

## Final Re-review Results

Documentation is clean. The other lanes confirmed the frozen-wire probe,
canonical session owner, exact release/ABA handling, bounded shutdown release,
enabled builder evidence, public source contract, and failure-safe cleanup
ordering. Four final corrections remain:

1. P1 API: `RemoteDelivery.source.releaseExpired` forwards only its first
   argument and drops the supervisor's operation controls. Forward inactivity
   and cancellation/deadline options and cover the adapter.
2. P1 maintainability/reliability: Admin observations never call the live
   `RemoteWorkRegistry.reconcile`, so an outcome-unknown quarantine can remain
   permanent after authoritative `NOT_PICKED`. Route every source snapshot/live
   observation through the canonical owner before supervisor notification.
3. P2 reliability: capacity one plus a write flood does not prove the active
   environment source overflowed or that supervisor snapshot/watch recovery ran.
   Add a deterministic observable recovery discriminator in the actual
   environment path; ordinary retained-row convergence is insufficient.
4. P2 style: a five-second child-stop timeout rejects but leaves the process
   alive. Escalate to a bounded forceful termination and wait for exit so no
   fixture can contaminate later tests.

These findings are one final bounded implementation batch. Only API,
style/maintainability, and performance/reliability require re-review afterward;
documentation remains accepted unless its files or claims change.

## Closure Re-review Endpoint

- Final corrected code endpoint: `09c17e5b`, clean and pushed.
- Focused typechecks, ESLint, Prettier, diff checks, and affected suites pass
  78/78 with no skipped acceptance.
- Only the affected API, style/maintainability, and reliability concerns are
  assigned for closure re-review, each to its existing reviewer with explicit
  `gpt-5.6-terra` / `high`. Runtime self-introspection is unavailable; immutable
  configured role/profile plus explicit dispatch are accepted unless a visible
  mismatch occurs.

## Closure Re-review Results

- TypeScript/API: clean. Both cleanup arguments are forwarded and covered; no
  public or serialized contract changed.
- Performance/reliability: the actual environment recovery sequence is proven
  across repeated real-gRPC runs, but the parent `exitWithin` race retains its
  losing timer or listener.
- Style/maintainability: reconciliation and forced termination are correct, but
  the child SIGTERM handler always exits zero and masks aggregated cleanup
  failures from the parent.

The same implementation context receives only these two fixture-cleanup P2
corrections: one settle path must clear the timer and listener, with forced-path
coverage, and child cleanup failure must propagate through a nonzero exit or
IPC failure. Only style and reliability reopen after correction.

## Fixture Cleanup Re-review Endpoint

- Corrected endpoint: `584b918f`, clean and pushed.
- Focused validation passes 42/42; typecheck, ESLint, Prettier, and diff checks
  are clean.
- Final confirmation is assigned only to the existing style/maintainability and
  performance/reliability reviewers, each explicit `gpt-5.6-terra` / `high`.
  Runtime self-introspection is unavailable; immutable role/profile and
  explicit dispatch remain the accepted metadata evidence.

## Forced-Exit Handoff Correction

Style confirmation is clean. Reliability found a fixture-only P2 race between
removing the graceful-exit listener, sending `SIGKILL`, and installing the
forced-exit listener. The orchestrator applied the permitted micro correction:
the forced observer is installed before the signal, and already-terminal child
state is handled immediately. ESLint, strict delivery-client TypeScript, diff
checks, and three consecutive real-gRPC file runs pass 6/6 each. Final
confirmation is assigned only to the existing reliability reviewer, explicit
`gpt-5.6-terra` / `high`.

## Final Acceptance

The reliability-only handoff confirmation is clean. All prior API,
style/maintainability, documentation, and performance/reliability findings are
resolved at pushed endpoint `2a5fcacc`. Security remains N/A for the recorded
reason. Reviewer runtime self-introspection was unavailable throughout; every
accepted result used the immutable existing role/profile and explicit dispatch
with no visible mismatch.

## Release-Gate Correction

The first converged `verify:release` attempt stopped at ESLint before coverage:
one internal type alias violated the interface rule, five commit callbacks
triggered the unbound-method rule, and one test guard was unnecessarily async.
The orchestrator applied this deterministic, review-neutral correction directly.
Affected ESLint/format checks and the delivery-fencing suite pass 9/9. The
release gate must be rerun after this correction; specialist concerns are not
reopened because behavior and public contracts did not change.

## Release Verification

The final `pnpm --config.verify-deps-before-run=false verify:release` run passes
at `95cf6a72`: 180 test files and 3,545 tests pass; 3 files and 25 tests are
intentionally skipped. Coverage passes all global thresholds: statements
94.02% (`19,555/20,797`), branches 90.01% (`11,091/12,321`), functions 94.53%
(`4,622/4,889`), and lines 94.90% (`18,414/19,403`). All deterministic build,
TypeScript, ESLint, cleanup, TSDoc, formatting, documentation, Proto, generated
output, and release-readiness gates pass in the same run.
