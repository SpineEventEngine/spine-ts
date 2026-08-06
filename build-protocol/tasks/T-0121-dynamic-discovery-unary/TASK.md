# T-0121: Dynamic Discovery And Unary Gateway Routing

Status: Focused re-review complete; second correction batch in progress

## Objective

Adds platform-neutral application-node discovery and lets one standalone
Gateway route commands and queries across a changing complete node set with
bounded, generation-fenced reconciliation.

The authoritative detailed slice is T-0121 in
`build-protocol/planning/WAVE_7_SCALING_REDEPLOYMENT_PLAN.md`.

## Classification

High-risk. This task introduces a public package and changes shared Gateway
membership, concurrency, cancellation, shutdown, and unary routing behavior.

## Baseline And Isolation

- Baseline: `origin/main@fa1ed36f`.
- Branch: `task/T-0121-dynamic-discovery-unary`.
- Worktree: `.worktrees/T-0121-dynamic-discovery-unary`.
- The stale dirty primary checkout remains coordination-only and untouched.

## Human-Imposed Requirements Ledger

1. One standalone Gateway discovers and uses every current application node.
2. The expected node count defaults to 32 but is not a cap. At least 40 nodes
   must all become routable with bounded connection-start concurrency.
3. Above-expectation ERROR logging belongs to Wave 8. Wave 7 keeps counts
   package-internal and exports no diagnostics/logging API.
4. Commands and queries select one current node, are not broadcast, and are not
   automatically retried after dispatch.
5. Reconciliation has one generation-fenced owner and at most one coalesced
   latest pending snapshot. Stale work cannot mutate the newer set.
6. Platform-neutral node descriptors use stable opaque IDs, canonical HTTP(S)
   origins, and optional normalized TLS server names under the exact Wave 7
   plan rules.
7. Scheme is explicit and defaults to HTTP. TLS server names are valid only for
   HTTPS and are normalized deterministically.
8. Existing fixed backend configuration remains available as a static discovery
   source for local and combined usage.
9. T-0121 separates unary validation from fixed subscription fan-in but does
   not remove the subscription count, topology field, or positional envelope;
   T-0122 owns those changes.
10. Zero nodes reports backend unavailability and later membership restores
    routing without restarting the Gateway.
11. Use `@spine-event-engine/deployment` for platform-neutral discovery. Do not
    create GKE/GCE packages, leases, DNS, metadata, Terraform, autoscaling, or
    operational logging in this task.
12. Use deterministic fake scheduling and no wall-clock sleeps.
13. Follow RED/GREEN/refactor and retain exact RED/GREEN evidence.
14. Do not build or modify Spine JVM, publish npm packages, push to the future
    migration remote, add Cloud Run, or add a second Gateway.
15. Push every commit to `origin` immediately.
16. Preserve user-owned files, especially `human-review-1-jul.md` and
    `human-review-22-jul.md`.

## Implementer Assignment

- Existing role: implementer.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both fields must be explicit in the dispatch.
- Ownership: `packages/deployment/**`, dynamic unary membership under
  `packages/auth/src/gateway/**`, standalone assembly under
  `packages/server/src/server/**`, focused tests/docs, and only required
  workspace/package/API metadata.
- The implementer must not spawn subagents or modify T-0122 subscription
  behavior.

## Implementer Result

- Accepted implementation endpoint: `5984e087`.
- Configured and explicitly dispatched role/profile: existing implementer,
  `gpt-5.6-terra` / `medium`.
- Actual runtime metadata: the child surface exposes no independent
  self-introspection. The immutable configured role/profile and explicit
  dispatch are the available evidence; no visible fallback or mismatch
  occurred.
- RED/GREEN evidence, five pushed implementation checkpoints, mechanical
  correction, focused tests, and preflight results are recorded in
  `build-protocol/work-logs/T-0121.md`.

## Verification

- Mandatory focused RED/GREEN commands and affected-package preflight.
- `pnpm verify:release` once after review convergence because shared Gateway
  runtime and public package metadata change.

## Review Concerns

- Style/maintainability: relevant.
- Documentation: relevant.
- TypeScript/API docs: relevant, Terra/high.
- Performance/reliability: relevant, Terra/high.
- Dedicated security review: N/A; trusted backend discovery does not change the
  authentication boundary.
