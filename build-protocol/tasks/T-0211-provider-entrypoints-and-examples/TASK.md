# T-0211 — Provider entrypoints and examples

**Status:** Review-complete; ready for isolated integration

**Baseline:** `origin/main@f3a2d92b30537c8290dee2c963d079d4d2f978dc`

## Classification

High-risk deployment integration. The managed replica, Coordinator, Gateway
membership, subscription, Delivery, and process-local integration mechanisms
already exist. This task must connect them through real provider and example
entrypoints without inventing another runtime concept.

## Accepted outcome

- Provider discovery publishes and consumes node-local Coordinator endpoints,
  never managed child application listeners.
- Managed examples use an explicit process count and an independently explicit
  Delivery shard strategy.
- Every managed child is a complete application replica and observes Delivery
  directly.
- Real command, query, subscription, and Delivery behavior crosses the
  Coordinator/Gateway path.
- Scale up, scale down, zero membership, return, and compatible replacement
  preserve Gateway-owned logical subscriptions.
- Browser and explicit local single-process `Server` usage remains independent
  of the managed Node process implementation.
- Replacement examples do not use ZeroMQ, generic signal routing, direct
  transport publication, or role-split application children.

## Ownership lanes

### Provider lane

Owns `packages/deployment-gke`, `packages/deployment-gce`, provider examples,
provider Terraform, provider documentation, and RED-32 provider acceptance.

### Example lane

Owns Message Board and Todo managed entrypoints, Compose/Kubernetes/container
fixtures, real command/query/subscription/Delivery smoke, and RED-31 retained
single-process/browser proof. It must not perform the final deletion owned by
T-0212.

## Gates

- RED-31: browser/local explicit single-process `Server` stays green and does
  not import managed Node process implementation.
- RED-32: provider discovery routes only to ready Coordinator endpoints through
  scale up/down/zero/return and compatible replacement.
- Real managed command/query/subscription/Delivery smoke passes.
- Documented deployment commands are mechanically tested.
- Changed executable line and branch coverage is at least 90%.
- Relevant specialist reviews, deterministic preflight, isolated integration,
  post-merge verification, push, and remote cleanup complete.
