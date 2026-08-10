# T-0155: Server Operational Logging

Status: In progress

## Objective

Add the selected WARN, ERROR, and no-log dispositions for server buses,
repository execution, services, and context registration/discovery boundaries.
Use the T-0154 LogLayer child and private emitter directly; do not add another
logging abstraction or broaden public API.

## Classification

High-risk. This task changes asynchronous failure containment and the
authentication-secret boundary across accepted server work.

## Human-Imposed Requirements Ledger

- Framework and application server code use LogLayer directly.
- Emit exactly once at the outer boundary that contains or terminates failure.
- WARN means degraded/retryable/best-effort work was contained and work
  continues. ERROR means accepted work or a signal was permanently dropped.
- Validation, domain rejection, empty routes, filter misses, normal lifecycle
  outcomes, rethrows, surfaced failures, and logger failures produce no record.
- Stable IDs may be logged. Payloads, exception objects/messages/stacks,
  headers, tokens, passwords, cookies, signing keys, and session/authentication
  secrets may not be logged.
- Product Markdown and README changes remain deferred to Wave 10.

## Baseline And Isolation

- Baseline: `origin/main@c9de9982`.
- Branch: `task/T-0155-server-operational-logging`.
- Worktree: `.worktrees/T-0155-server-operational-logging`.
- Preserve the dirty primary checkout and unrelated worktrees.
- Push only to `origin`; never push the upstream remote.

## Acceptance Criteria

1. Attach the exact environment logger child to built contexts, their Event
   buses/repository failure recorder, and `SpineServices` through package-private
   start-time seams. Do not add a public logger option or fallback logger.
2. Record one ERROR when an EventBus subscriber throws and its accepted Event
   update is dropped; continue later subscribers and preserve post outcome.
3. Record one ERROR when accepted repository follow-up dispatch fails. Preserve
   the bounded copy-safe diagnostic and avoid an inner duplicate record.
4. Record one WARN when detached best-effort service subscription cleanup fails.
   Preserve service/stream outcomes and observe every rejection.
5. Record no log for command/query validation or domain failures, empty Event
   routes, surfaced/rethrown construction or service failures, and test-only
   structural fallbacks.
6. Add stable adjacent containment IDs and manifest entries for every actual
   suppression in the owned bus, repository, service, and context partition.
7. Use only the frozen allowlisted fields and fixed messages/codes. Tests must
   prove no payload, exception detail, header, credential, or session secret
   reaches LogLayer.
8. Logging throws and callable/object thenable rejections may not alter business
   outcomes or create unhandled rejections.
9. Begin production behavior with focused RED tests and reach at least 90% in
   every metric for changed production sources.
10. Run focused tests, generated/package typechecks, changed TypeScript ESLint,
    TSDoc, Prettier, containment checking, prohibited-secret scans,
    `git diff --check`, the required style/reliability review wave, affected
    re-review, and one final `verify:task` after convergence.

## Exclusions

- Delivery, Stand, subscription-registry/runtime, environment-close, and worker
  lifecycle boundaries assigned to T-0156.
- Auth, delivery-client/server, and deployment boundaries assigned to T-0156A.
- Public logging API or TSDoc changes, Google Cloud composition, routing,
  `@Where`, model conventions, rejections, examples, and product Markdown.

## Implementation Assignment

- Existing role: implementer acting as a senior TypeScript server-runtime
  engineer.
- Ownership: the exact server bus/repository/service/context sources, their
  focused tests, the server containment manifest partition, and T-0155 records.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both dispatch fields must be explicit. The implementer must not spawn
  subagents and must preserve unrelated changes.

## Review And Verification

- Style/maintainability: required; configured `gpt-5.6-terra` / high.
- Performance/reliability: required; configured `gpt-5.6-terra` / high.
- TypeScript/API documentation: N/A because no public declarations or exports
  may change.
- Documentation: N/A because public TSDoc and product Markdown are excluded.
- Security: deferred to T-0167; deterministic secret-negative tests are
  mandatory here.
