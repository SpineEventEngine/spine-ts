# T-0205 specialist review

## Review configuration

The orchestrator dispatched one complete concern-specific review wave after
deterministic convergence. Subagent spawning was prohibited. The execution
surface did not expose runtime self-telemetry, so the immutable configured
roles and profiles are the available evidence.

| Concern                 | Existing role                      | Model           | Reasoning | Result                    |
| ----------------------- | ---------------------------------- | --------------- | --------- | ------------------------- |
| TypeScript/API          | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` | high      | Pass                      |
| Performance/reliability | `performance_reliability_reviewer` | `gpt-5.6-terra` | high      | Two P1 findings           |
| Style/maintainability   | `style_maintainability_reviewer`   | `gpt-5.6-terra` | high      | One P1 and one P2 finding |

Documentation review is not separately applicable: T-0205 adds no public
reader documentation, and the TypeScript/API reviewer verified that the
kernel remains absent from public declarations and TypeDoc entrypoints.
Security review remains reserved for final release convergence because this
task introduces no new external trust boundary or wire input.

## Passing disposition

The TypeScript/API review found no P0-P2 issue. The kernel is absent from the
deployment root export and is reachable only through the explicit internal
package subpath used by Auth. Auth's emitted declaration keeps the kernel in a
private field. No public Protobuf or TypeScript contract changed.

## Consolidated correction batch

1. **P1 — latest membership must win during awaited removal.** A superseded
   reconciliation can continue after a blocked cleanup and remove another
   member retained by the newest snapshot. Re-check the generation after every
   awaited removal/cleanup and prove `[a,b] -> []` blocked on `a`, followed by
   `[b]`, retains `b` without a close/recreate cycle.
2. **P1 — retain compensation failures.** Oversized and stale child creation
   paths dispose directly. A rejected disposal is not retained for retry and
   can leak. Route both through the kernel's failed-child-cleanup retention and
   prove first-failure then successful retry for each path.
3. **P1 — prove recursive child identity at the Gateway adapter.** The direct
   kernel test proves only an injected string callback, not the Protobuf clone
   and rewrite performed by `DynamicUnaryForwarder`. Add a two-level adapter
   test that decodes each child definition and proves only the immediate child
   subscription ID changes; payload, actor, tenant, event data, logical public
   identity, and relayed updates remain intact.
4. **P2 — make the internal kernel vocabulary provider-neutral.** Replace
   Gateway/Auth-specific error and `auth.dynamic_*` log-boundary terminology
   inside the deployment kernel with neutral membership terminology, while
   preserving externally observable Gateway compatibility where applicable.
   Update containment expectations.

Re-review only performance/reliability and style/maintainability after the
single correction batch. TypeScript/API need not reopen unless the correction
changes exports or declarations.

## Correction re-review

- Performance/reliability re-review passed with no P0-P2 findings. It verified
  latest-generation fencing after awaited cleanup, retained retry for failed
  stale/oversized child compensation, serialized reconciliation, bounded
  starts, cleanup ordering, and close idempotency. The focused 88-test suite
  and `git diff --check` passed.
- Style/maintainability re-review passed with no P0-P2 findings. It verified
  the real two-level Protobuf child identity proof, provider-neutral kernel
  vocabulary, narrow Gateway compatibility translation, and absence of a
  duplicated membership algorithm. Its focused four regressions and diff
  hygiene passed.
- Both re-reviews used the existing configured reviewer roles with
  `gpt-5.6-terra` / `high`; runtime telemetry was unavailable. TypeScript/API
  did not reopen because no export or declaration changed in the correction.
- The complete review wave is converged.
