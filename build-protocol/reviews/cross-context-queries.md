# Cross-context queries review log

Status: implementation and preflight complete; independent review in progress.

## Plan review

The approved analysis received one Astra/high architecture pass and one fresh
Sol/medium standalone review without history/memory. Accepted findings are now
requirements: two-phase all-context shutdown and retryable cleanup for routing
validation before attachment. No open product decisions remain.

## Required code-review concerns

- Style/maintainability: pending; changed runtime structure and small methods.
- Documentation: pending; user-facing workflow and example claims.
- TypeScript/API docs: pending; query/tenant contracts and application snippets.
- Performance/reliability: pending; tenant isolation, routing, startup and drain.

Run independent relevant reviewers after preflight, with fresh contexts and the
complete Human-Imposed Requirements Ledger. Aggregate findings before fixes.
Only substantively changed concerns reopen after corrections. Final security
disposition is recorded at release readiness, not as an early duplicate review.

## Planned independent assignments

Every assignment starts without chat history or memory, reads the complete
Human-Imposed Requirements Ledger in the approved plan, and compares the final
runtime or documentation diff against baseline `2324311be8c23024f66cb2ba702fbe99a99e7dfb`.
Reviewers must verify claims against implementation and tests, not assume that
the plan or this log proves correctness. No reviewer edits files or dispatches
children. Explicit dispatch profiles:

- Existing style/maintainability reviewer: gpt-6-sol / medium. Changed runtime
  and example structure, reuse, simple documentation and unnecessary API surface.
- Existing TypeScript/API documentation reviewer: gpt-6-sol / medium. Query and
  tenant public contracts, registered schema handling, declarations and examples.
- Existing performance/reliability reviewer: gpt-6-sol / medium. Tenant isolation,
  visibility, server separation, startup/recovery, cleanup/retry and shutdown.
- Existing documentation reviewer: gpt-6-luna / medium. Changed human-readable
  guidance, example instructions and agreement with actual behavior.

The desktop surface supports these explicit configurations; no separate runtime
model metadata is exposed. Record any visible mismatch rather than asking the
reviewer to infer its model. Wait for the complete wave before one correction
batch. This section records intended dispatches, not completed reviews.

## Review at 78addab7a

The desktop surface refused a second simultaneous review dispatch with
`agent thread limit reached`. Reviews are therefore sequential, but findings
remain collected until the whole wave completes. Every successful dispatch has
explicit model/reasoning and no inherited history; runtime metadata is not
separately exposed.

Style/maintainability (gpt-6-sol / medium) completed: one P2 coverage finding.
The shutdown regression pauses a direct CommandBus dispatcher and reads Stand,
so it proves the two-phase close correction but does not exercise PM `select()`
during shutdown. Add the promised PM query regression in both context orders;
retain the existing direct-dispatch test because it catches a distinct race.
No other confirmed style/maintainability findings. API review is in progress;
reliability and documentation reviews are pending available capacity.

TypeScript/API documentation (gpt-6-sol / medium) completed: one P1 mask-name
finding. EntityQueryBuilder accepts generated property names but stores Proto
field names in the plan; RegisteredTargets compared masks to `field.localName`.
A valid `mask("skuName")` therefore fails for Proto `sku_name`. Compare to the
Proto field name and test the complete masked read. The reviewer also identified
an existing storage-mask property-name mismatch that must be checked to deliver
the promised valid query result; do not call that older mismatch introduced by
this change. No other confirmed API/declaration/compatibility findings.
Reliability review is now running at the same unchanged checkpoint.

Performance/reliability (gpt-6-sol / medium) completed: no confirmed runtime
defect. It independently confirmed the paused-PM shutdown coverage gap and
added one P2 recovery gap: checking the lookup while tenant work is enumerated
does not prove replayed persistent delivery actually executes a foreign PM
query. Add pending-work replay with a successful real handler read. Existing
route-install timing and direct-dispatch shutdown tests remain useful and stay.

Documentation (gpt-6-luna / medium) completed clean: changed guides, reference,
links, snippets and Orders instructions match the implementation and scope.
No tests/builds run by reviewers. All four configured profiles were explicit
and correct; no runtime mismatch was exposed. The complete wave is accepted.

One correction batch goes to the retained implementer: fix mask-name validation
and prove the selected camelCase property survives a real local/foreign read;
add actual recovered PM querying; add paused PM querying during shutdown in
both context orders without removing the existing direct-dispatch race test.
API and reliability concerns reopen for these substantive corrections; style
needs only confirmation of the promised PM test, documentation remains clean
unless public prose/behavior changes.

Correction preflight passes: 77 PM/Stand tests, tooling typecheck, scoped lint
and formatting, cleanup and TSDoc. Main also checked that the new rejection
handler declares an optional Command result rather than bypassing declaration
rules with void. Two fresh re-review dispatches are planned with explicit
gpt-6-sol / medium: existing API reviewer for the mask correction and Stand
contract/docs; existing reliability reviewer for real recovery/shutdown tests
and changed masking. Neither receives prior reviewer history or memory. They
read original requirements and current source/tests independently.
