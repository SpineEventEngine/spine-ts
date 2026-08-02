# T-0091: Durable subscription registry foundation

Status: Complete
Start: `2026-08-02`
Baseline: `a33364f9`
Branch: `task/T-0091-durable-subscription-registry`
Worktree: `.worktrees/T-0091-durable-subscription-registry`
Parent: `T-0089`

Classification: High-risk. This task evolves a public asynchronous admission
contract, persists authentication-owned private subscription state, and makes
production startup fail closed.

## Objective

Deepens the existing `SubscriptionBindings` seam with awaitable capacity
reservation and one `StorageFactory`-backed durable implementation. It stores
versioned, bounded, namespace-isolated gateway records and requires explicit
durable bindings for production browser/gateway assembly. In-memory bindings
remain available only for explicit local and test use.

## Acceptance Criteria

1. `SubscriptionBindings.reserveCapacity()` becomes awaitable. The in-memory
   implementation preserves its current finite behavior, and one failed
   Subscribe releases its reservation exactly once.
2. Durable create, read, close, and reopen round-trip the approved public ID,
   private backend envelope, principal fingerprint, optional tenant, session
   expiry, lifecycle, finite claim/lease placeholders, cancellation fence,
   byte accounting, and record version without aliasing byte arrays.
3. Explicit logical namespaces isolate applications using one storage
   provider. Missing/blank namespaces and invalid finite lease, cleanup,
   global-record, or per-record-byte bounds reject during construction.
4. Malformed, oversized, wrong-version, wrong-key, inconsistent-identity, or
   provider-incompatible CAS state fails closed and never exposes private
   backend bytes through public results or error text.
5. Principal, tenant, and session-expiry ownership checks remain mandatory.
   Registry storage is opened and closed independently of application-data
   storage and independently of a Spine TS or JVM backend target.
6. Production combined assembly rejects absent or volatile bindings before
   listener startup. The durability capability and shared production
   admission seam are reusable by the standalone host introduced in T-0093;
   local/tests may explicitly select in-memory bindings.
7. This task does not implement cross-gateway leases, fencing races, durable
   cleanup scheduling, hosting/auth routes, deployment topology, or a second
   subscription persistence abstraction. Those remain T-0092 and later work.

## Human-Imposed Requirements Ledger

- Apply the approved Wave 5 plan and B1 execution split without reopening its
  product decisions.
- Reuse `SubscriptionGateway`, `SubscriptionBindings`,
  `InMemorySubscriptionBindings`, the service-owned codec patterns,
  `StorageFactory`, `RecordStorage`, and `compareAndSet()`.
- Give gateway registry records a distinct namespace and one versioned codec;
  do not repurpose service-owned Subscription RPC records.
- Storage selection remains application code. The framework accepts a supplied
  storage factory; infrastructure does not choose Datastore, MySQL, or another
  provider.
- Follow RED-GREEN-REFACTOR with focused auth/server/storage tests and
  changed-source coverage. Keep one production-code writer.
- Push every feature-branch commit immediately. Do not build Spine JVM, add a
  deployment CLI, or touch either protected `human-review` file.

## Implementation Dispatch

- Existing role: `implementer`.
- Ownership: `packages/auth/src/subscriptions/**`, the minimum exports/tests;
  one durable gateway codec/binding implementation in `packages/server/src/**`,
  server browser production assembly and focused tests/TSDoc/reference claims,
  plus this task's records. No service-owned RPC record behavior, standalone
  host, auth routes, delivery-client, container, Compose, or Kubernetes files.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: medium.
- Both fields must be explicit. Runtime metadata is recorded when exposed;
  otherwise the immutable configured role/profile and limitation are evidence.
- The implementer must not spawn children or merge. It commits only coherent
  tested checkpoints and pushes each one immediately.

## Verification

- Baseline and focused RED/GREEN: auth subscriptions, durable codec/storage,
  production admission, provider CAS compatibility, restart, ownership, and
  byte-copy/fail-closed tests.
- Cheap preflight: generated build/tooling, affected lint, cleanup/TSDoc,
  formatting, docs/API, generated cleanliness, and `git diff --check`.
- Final profile: `verify:release` once after review convergence.

## Review Assignments

- Style/maintainability: existing reviewer, `gpt-5.6-terra` / high.
- Documentation: existing reviewer, `gpt-5.6-luna` / medium.
- TypeScript/API docs: existing reviewer, `gpt-5.6-terra` / high.
- Performance/reliability: existing reviewer, `gpt-5.6-terra` / high.
- Final security review remains the existing Wave 5 release gate in T-0089;
  this slice adds no separate reviewer role. Private-byte non-disclosure and
  fail-closed behavior are nevertheless mandatory acceptance tests now.

All required model and reasoning fields are recorded before dispatch.
Reviewers receive one converged checkpoint and return one aggregated batch.

## Completion

- The awaitable binding contract, durable namespaced registry, bounded codec,
  provider capability, production admission, and public guidance meet every
  acceptance criterion.
- Two complete specialist waves converged and all accepted findings are
  resolved. The final direct acceptance cleanup changed no public contract.
- Focused final evidence is 4 files and 169 tests passing. The full
  `verify:release` command exited `0`; its exact repository-wide Vitest totals
  were not retained and are not inferred.
- The task branch and every checkpoint are synchronized with `origin`. Parent
  T-0089 owns merge and post-merge verification evidence.
