# T-0107 Review Record

Status: Corrections Required

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
