# T-0122: Dynamic Subscription Reconciliation

Status: Correction batch complete; focused re-review pending

## Objective

Makes one logical Gateway maintain one native subscription stream on every
currently discovered application node without making transient topology part
of durable subscription identity.

The authoritative slice is T-0122 in
`build-protocol/planning/WAVE_7_SCALING_REDEPLOYMENT_PLAN.md`.

## Classification

High-risk. This task changes durable subscription encoding, concurrent stream
ownership, cancellation, restart behavior, and shared Gateway assembly.

## Baseline And Isolation

- Baseline: `origin/main@d3aee369` with integrated T-0121.
- Branch: `task/T-0122-dynamic-subscriptions`.
- Worktree: `.worktrees/T-0122-dynamic-subscriptions`.
- The dirty primary checkout remains coordination-only and protected.

## Human-Imposed Requirements Ledger

1. One logical Gateway maintains one native stream per active durable
   subscription on every discovered node.
2. Adding, removing, re-adding, reordering, or replaying nodes converges without
   deleting the shared definition or duplicating a per-node stream.
3. Activation and membership changes share T-0121's single latest-only,
   generation-fenced reconciliation owner; no second topology queue exists.
4. Late work for removed nodes cannot resurrect streams. Cancel and close fence
   and join discovery/activation work, while interrupted cleanup remains
   restart-recoverable.
5. Zero nodes retain durable definitions. Existing definitions reactivate when
   nodes return without browser re-subscription; new backend-dependent creation
   reports unavailability while no node exists.
6. Durable identity contains only logical subscription ID, principal ownership,
   tenant, and canonical Subscription definition.
7. Delete topology fingerprints, ordered child indexes, positional private
   envelopes, and the 1-to-32 count validation from the dynamic subscription
   path.
8. Write only `spine.gateway.SubscriptionBinding:v4`. This is an intentional
   incompatible cutover: no v3 read, migration, dual-write, shim, or legacy
   restart fixture exists.
9. Every one of at least 40 discovered nodes receives one native stream with
   bounded concurrent starts; 32 remains an expectation, never a cap.
10. Duplicate best-effort updates remain allowed. Browser clients continue to
    treat notices as hints and re-query authoritative state after reconnect.
11. Update deployment, auth, and server documentation without promising
    complete notification history or exposing internal task jargon.
12. Do not add platform adapters, leased registry storage, Terraform, multiple
    Gateways, logging, Cloud Run, or compatibility handshakes.
13. Follow RED/GREEN/refactor, use deterministic scheduling, and record exact
    evidence.
14. Push every commit to `origin` immediately and preserve protected/user-owned
    files.

## Implementer Assignment

- Existing role: implementer.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both fields must be explicit in the dispatch.
- Ownership: dynamic subscription runtime under `packages/auth/src/gateway/**`
  and `packages/auth/src/subscriptions/**`, the minimum discovery bridge under
  `packages/deployment/**`, standalone assembly under
  `packages/server/src/server/**`, focused tests/docs, and required package/API
  metadata.
- The implementer must not spawn subagents and must not modify platform
  adapters, registry storage, Terraform, or Wave 8 logging.

## Architecture Blocker Split

The first RED slice demonstrated that durable v3 binding identity, native
fan-in activation, and T-0121 membership ownership cannot be changed safely as
independent patches. The existing requirements-splitter role is dispatched at
this demonstrated architectural blocker only.

- Existing role: requirements splitter.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: `high`.
- Both fields must be explicit in dispatch.
- Scope: produce a bounded implementation packet mapping the single generation
  owner, v4 logical record, ephemeral stream lifecycle, cancellation/restart,
  and deletion of positional topology. It must not invent new requirements,
  edit code, or split T-0122 into new human-facing tasks.

Result: accepted. The durable packet is
`build-protocol/planning/T-0122_IMPLEMENTATION_PACKET.md`. Runtime
self-introspection was unavailable; the explicit immutable role/profile is the
accepted evidence with no visible mismatch.

## Verification

- Mandatory focused RED/GREEN commands and affected-package preflight.
- `pnpm verify:release` after review convergence because shared subscription
  runtime, durable restart behavior, and cross-package assembly change.

## Implementation Evidence

- The dynamic owner retains logical definitions across zero-node intervals and
  creates one ephemeral native child per current node only after public
  activation.
- Deterministic lifecycle tests cover a deferred add/Activate race, same-ID
  node recovery, cancellation and close during delayed creation, unexpected
  child completion followed by replay, reordering, cleanup retry, forty-node
  fan-in, and bounded start concurrency.
- Focused preflight passed at `eb74a2ac`: six affected suites ran 330 tests,
  generated typechecking passed, and scoped lint, Proto, TSDoc, documentation
  audience, formatting, and diff checks passed. Specialist review and release
  verification remain required.

## Review Concerns

- Style/maintainability: relevant.
- Documentation: relevant.
- TypeScript/API docs: relevant, Terra/high.
- Performance/reliability: relevant, Terra/high.
- Dedicated security: N/A; authentication remains solely at the existing one
  Gateway and its trust boundary is unchanged.
