# T-0144: Invention Audit And Wave 8 Closure

Status: Complete under the remote-synchronization contract recorded below.

## Objective

Prove that the repository contains only approved persistence, serialized
boundaries, public APIs, limits, lifecycle mechanisms, provider layouts,
examples, and current documentation claims before Wave 9 begins.

## Classification

High-risk release closure. The implementation is expected to be audit records
and deterministic checks only, but the task inventories the complete Wave 8
runtime and owns the single repository-wide `verify:release`.

## Acceptance

- Inventory every Wave 8 persisted record and serialization boundary, public
  API, hidden limit, retry/quota/cleanup mechanism, delivery, subscription,
  authentication, deployment/provider layout, example, and current
  documentation claim.
- Classify each item as human-approved, JVM counterpart, approved
  TypeScript-specific necessity, removed, or requiring a human decision.
- Name every forbidden Wave 8 artifact explicitly in deterministic checks,
  including `RemovalQuarantine`, removal fingerprints, receipts, markers,
  per-message claims, delivery attempts/exhaustion, revoked-session storage,
  versioned discovery keys, `ApplicationNodeLease:v1`, and the retired
  `@spine-event-engine/validation-ts` package.
- Preserve historical plans, decisions, reports, task records, reviews, and
  source evidence; deterministic current-state checks must exclude them
  explicitly rather than rewrite history.
- No unresolved invention or human decision may cross into Wave 9.
- Run the mandatory cheap preflight, one complete four-concern review wave,
  one aggregated correction batch if required, and the single
  `pnpm verify:release` after convergence.
- Merge the verified tree, prove post-merge identity or run the protocol's
  required focused proof, push the task/integration/main refs to `origin`, and
  verify those remote refs.

## Ownership And Exclusions

- Ownership is limited to audit records and deterministic audit scripts.
  Runtime findings return to the owning implementation context; this task does
  not design replacements.
- Wave 9 logging/Cloud Logging/copyright work, Wave 10 multiple Gateways, Cloud
  Run, npm publication, migration tooling, and Spine JVM builds are excluded.
- Push only to `origin`; never push to `spine-event-engine`.

## Review

- TypeScript/API documentation, performance/reliability,
  style/maintainability, and documentation concerns are all required over the
  affected audit evidence.
- Security is N/A unless the audit or a correction changes a trust boundary.

## Closure

The release-verified task tree was merged without conflicts as `ce0b9476`; its
tree is byte-identical to the task endpoint. Focused post-merge verification
passes 18 files / 406 tests plus every deterministic task gate. This record
cannot include the content-addressed SHA of its own commit. Its completion
contract is therefore to push this record to the task, integration, and `main`
refs on `origin`, then confirm externally that all three refs resolve to that
same commit. No ref is pushed to `spine-event-engine`.
