# T-0203 — Complete-replica deployment and hierarchical subscriptions plan

**Status:** Accepted; planning complete.

## Objective

Freeze the post-Wave-13 correction which replaces role-split ZeroMQ execution
with explicitly sized complete application replicas, a node-local
service-aware HTTP/2 Coordinator, direct Delivery observation in every replica,
and two-level subscription fan-out owned durably only by the Gateway.

This task is planning-only. It does not implement or delete runtime code.

## Baseline and classification

- Spine TS baseline: `7980f0ebf5257d4df285ae07650c4ebb8d6eb1f2` from freshly fetched
  `origin/main`.
- Wave 13 is complete, release-verified, integrated, pushed, and remotely
  closed under T-0202.
- Risk: **high**. The future implementation changes process supervision,
  network admission, subscription lifecycle, delivery readiness, public
  environment settings, and a published transport surface.
- Protected primary checkout: coordination/read-only only. Planning occurs on
  `codex/wave13-deployment-subscription-plan` in the isolated fresh clone.

## Planning artifacts

- Human requirements: `HUMAN_REQUIREMENTS.md`.
- Frozen architecture and implementation split:
  `build-protocol/planning/T-0203_COMPLETE_REPLICA_DEPLOYMENT_PLAN.md`.
- Temporary root planning files are removed before task commit.

## Completion gate

1. Current Wave 13, Delivery, Gateway, subscription, hosting, and ZeroMQ state
   is traced from current main.
2. Every human requirement has an owner and behavioral proof.
3. The dependency-ordered implementation tasks have exclusive file ownership,
   RED designs, review dispositions, documentation ownership, and a final
   release/remote-closure task.
4. Unexpected worker exit preserves degraded service and uses the accepted
   bounded replacement policy, with behavioral proofs assigned to T-0206.
5. ZeroMQ and the generic signal-routing layer are deleted by T-0212 only after
   the replacement HTTP/2 topology is accepted, with no hidden fallback.
