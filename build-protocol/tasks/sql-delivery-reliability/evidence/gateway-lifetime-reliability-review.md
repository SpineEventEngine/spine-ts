# Gateway lifetime reliability review

Existing performance/reliability reviewer, explicit `gpt-6-sol` / `medium`; actual runtime introspection unavailable. Parent persists the returned report because the reviewer interpreted its read-only role as prohibiting evidence-file edits. No source edit, test, build, or service operation by reviewer.

## Confirmed findings

- **P1: Intentional pre-ACK child removal can fail logical activation.** In backend-membership-kernel.ts around 945, the rejection handler calls `#failReadiness()` before checking child identity/cancellation. `#removeMemberChildren()` deletes and aborts a replaced child. An adapter rejecting on abort can therefore reject pending logical readiness even if the replacement attaches and ACKs. Validate current child/controller and intentional cancellation before reporting readiness or lifetime failure. Existing replacement tests use an activation that resolves on abort, so add the rejecting-on-abort case. This violates D-0133's intentional replacement requirement.
- Corroborates API review's **P1 generic cleanup**: `#failActivation()` skips `cancel()` when readiness is undefined. This is the same finding, not an additional one.

Frozen scope: kernel production diff, membership tests and dynamic subscription creator test, D-0133 decision and human ledger. Full real managed relay and latest-built final transport acceptance remain pending. No claim that source-only review establishes runtime verification.
