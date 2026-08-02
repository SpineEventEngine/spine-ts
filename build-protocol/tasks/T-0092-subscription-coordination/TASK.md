# T-0092: Two-gateway subscription coordination

Status: Ready for merge
Start: `2026-08-02`
Baseline: `229b610e`
Branch: `task/T-0092-subscription-coordination`
Worktree: `.worktrees/T-0092-subscription-coordination`
Parent: `T-0089`

Classification: High-risk. This task changes cross-process ownership,
concurrent persistence, lease/fence semantics, global admission, cancellation,
and restart-safe retention.

## Objective

Deepens the T-0091 durable registry so two independently opened gateways over
one backing namespace coordinate every binding through durable atomic facts.
Only one valid owner may perform or forward backend work. Claims, renewals,
cancellation, cleanup, accounting, ambiguous store outcomes, and restart must
remain finite, fenced, retry-safe, and private.

## Acceptance Criteria

1. Two registries racing to activate one inactive binding produce one durable
   winner with a unique fence/version and finite renewable lease. Unexpired
   claims cannot be stolen; expired claims recover within bounded attempts.
2. If gateway A loses its lease while its backend stream remains open and
   gateway B takes over or cancels, A cannot forward an update, finalize, or
   resurrect the record after resuming.
3. Cancellation is retry-safe, wins through a durable fence, and can reach
   either gateway. Subscribe/activate/cancel/renew/abort/close interleavings
   converge to one valid durable state with bounded local controllers.
4. A compare-and-set that applies and then reports an ambiguous failure is
   reconciled by rereading version/fence before another mutation or backend
   effect.
5. Two gateways racing on admission cannot exceed the namespace-global record
   limit. Failed creation returns capacity exactly once, and encoded per-record
   byte limits are enforced before persistence.
6. Expired cleanup uses finite batches, durable continuation, bounded retries,
   and durable failure backoff. Restart resumes it; concurrent cleaners do not
   double-account or delete a current replacement.
7. Crashes between mutation and accounting/continuation updates remain
   repairable from durable facts. Retained timers, controllers, errors,
   continuations, and private payloads remain bounded and sanitized.
8. Persistence preserves logical records and coordination, not a live stream.
   Reconnect/re-query remains required; no replay, exactly-once, global order,
   or cluster-complete update guarantee is introduced.
9. No scheduler abstraction, host, deployment controller, storage selector,
   new generic cursor API, or parallel registry/persistence mechanism is added.

## Human-Imposed Requirements Ledger

- Apply the approved Wave 5 plan and B2 split without reopening decisions.
- Reuse T-0091 `SubscriptionBindings`, `DurableSubscriptionBindings`, its
  versioned codec, `StorageFactory`, bounded record queries, and atomic
  `compareAndSet()` capability.
- Keep all cross-gateway ownership and fencing in durable atomic records.
- Provider work, retries, leases, cleanup batches, continuations, stored bytes,
  and local retained state must be finite and explicitly bounded.
- Use deterministic controlled clocks, barriers, and fault-injecting storage;
  do not rely on wall-clock sleeps for race correctness.
- Follow RED-GREEN-REFACTOR. Keep one production-code writer and push every
  tested feature-branch commit immediately.
- Do not build Spine JVM, implement Wave 6 notification propagation, or touch
  either protected `human-review` file.

## Requirements Splitter Dispatch

- Existing role: `requirements_splitter`.
- Scope: refine the frozen B2 acceptance into the smallest dependency-ordered
  implementation checkpoints, exact durable state transitions/invariants,
  deterministic RED race/fault tests, file ownership, reviewer concerns, and
  verification gates. It may identify a true conflict but may not expand B2.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: high.
- Both fields must be explicit. Runtime metadata is recorded when exposed;
  otherwise the immutable configured role/profile and limitation are evidence.

## Implementation Dispatch

- Existing role: `implementer`.
- Ownership: the T-0091 durable binding/codec and focused tests, the minimum
  auth binding contract changes proven necessary by RED tests, provider test
  doubles/conformance where required, public TSDoc/reference claims, and this
  task's records. No browser host/auth routes, delivery-client, container,
  Compose, or Kubernetes files.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: medium.
- The implementer must not spawn children or merge. It receives the accepted
  splitter output, owns all overlapping production files, and pushes every
  coherent tested checkpoint immediately.

## Verification

- Focused deterministic two-registry race/fault/retention tests with controlled
  clocks, barriers, ambiguous CAS, restart, provider bounds, and
  changed-source coverage.
- Cheap preflight: generated build/tooling, affected lint, cleanup/TSDoc,
  formatting, docs/API, generated cleanliness, and `git diff --check`.
- Final profile: `verify:release` once after review convergence.

## Review Assignments

- Style/maintainability: existing reviewer, `gpt-5.6-terra` / high.
- Documentation: existing reviewer, `gpt-5.6-luna` / medium.
- TypeScript/API docs: existing reviewer, `gpt-5.6-terra` / high.
- Performance/reliability: existing reviewer, `gpt-5.6-terra` / high.
- Final security remains the T-0089 Wave 5 release gate. This slice still
  requires private payload/error sanitization and fail-closed ownership tests.

All child model/reasoning fields are recorded before dispatch. Runtime metadata
limitations do not invalidate immutable configured-role evidence.
